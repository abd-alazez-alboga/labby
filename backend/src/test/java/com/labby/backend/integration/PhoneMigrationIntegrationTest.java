package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * Review V1 H3 (owner ruling 2026-10-20): V35 rewrites stored phones to E.164 with the Syria
 * default — the rules of {@code PhoneNumbers.normalize} — and fails fast, naming the accounts, when
 * two accounts collapse onto one number. Runs on a scratch database of the shared Testcontainer
 * migrated to V32 (the last migration before V35 that touches phones).
 */
class PhoneMigrationIntegrationTest extends AbstractIntegrationTest {

  private static final String SCRATCH_DB = "labby_v35_phones";

  @Autowired private JdbcTemplate jdbcTemplate;

  @Value("${spring.datasource.username}")
  private String username;

  @Value("${spring.datasource.password}")
  private String password;

  private String scratchUrl;
  private JdbcTemplate scratch;

  @BeforeEach
  void createScratchDatabase() {
    jdbcTemplate.execute("DROP DATABASE IF EXISTS " + SCRATCH_DB + " WITH (FORCE)");
    jdbcTemplate.execute("CREATE DATABASE " + SCRATCH_DB);
    String url =
        jdbcTemplate.execute(
            (ConnectionCallback<String>) connection -> connection.getMetaData().getURL());
    scratchUrl = url.replaceFirst("/[^/?]+(\\?|$)", "/" + SCRATCH_DB + "$1");
    scratch = new JdbcTemplate(new DriverManagerDataSource(scratchUrl, username, password));
  }

  @AfterEach
  void dropScratchDatabase() {
    jdbcTemplate.execute("DROP DATABASE IF EXISTS " + SCRATCH_DB + " WITH (FORCE)");
  }

  private Flyway flyway(String target) {
    return Flyway.configure()
        .dataSource(scratchUrl, username, password)
        .locations("classpath:db/migration")
        .target(target)
        .load();
  }

  @Test
  @DisplayName("V35 rewrites every stored phone form to E.164 with the +963 default")
  void shouldNormalizeStoredPhones() {
    flyway("32").migrate();
    UUID local = user("0933000111");
    UUID noPlus = user("963933000112");
    UUID spaced = user("+963 933-000-113");
    UUID doubleZero = user("00963933000114");
    UUID canonical = user("+963933000115");
    UUID foreign = user("+447700900123");
    scratch.update(
        "INSERT INTO otp_codes (phone, code_hash, purpose, expires_at) VALUES ('0933000111', 'h',"
            + " 'register', now() + interval '5 minutes')");
    scratch.update(
        "INSERT INTO login_failures (phone, client_ip, window_start, failures) VALUES"
            + " ('0933000111', '10.0.0.1', now(), 2), ('+963933000111', '10.0.0.1', now(), 3),"
            + " ('963933000112', '10.0.0.1', now(), 1)");

    flyway("latest").migrate();

    assertThat(phoneOf(local)).isEqualTo("+963933000111");
    assertThat(phoneOf(noPlus)).isEqualTo("+963933000112");
    assertThat(phoneOf(spaced)).isEqualTo("+963933000113");
    assertThat(phoneOf(doubleZero)).isEqualTo("+963933000114");
    assertThat(phoneOf(canonical)).isEqualTo("+963933000115");
    assertThat(phoneOf(foreign)).isEqualTo("+447700900123");
    assertThat(scratch.queryForObject("SELECT phone FROM otp_codes", String.class))
        .isEqualTo("+963933000111");
    // The canonical window keeps throttling; the variant moves or is dropped.
    assertThat(
            scratch.queryForList(
                "SELECT phone || ':' || failures FROM login_failures ORDER BY phone", String.class))
        .containsExactly("+963933000111:3", "+963933000112:1");
    // The helper function is gone again.
    assertThat(
            scratch.queryForObject(
                "SELECT count(*) FROM pg_proc WHERE proname = 'labby_v35_normalize_phone'",
                Integer.class))
        .isZero();
  }

  @Test
  @DisplayName("V35 fails fast, naming both accounts, when two accounts share a number")
  void shouldFailFastOnCollidingAccounts() {
    flyway("32").migrate();
    UUID local = user("0933000121");
    UUID canonical = user("+963933000121");

    assertThatThrownBy(() -> flyway("latest").migrate())
        .hasMessageContaining("V35: several accounts share one phone")
        .hasMessageContaining(local.toString())
        .hasMessageContaining(canonical.toString());
    // Nothing was rewritten.
    assertThat(phoneOf(local)).isEqualTo("0933000121");
  }

  private UUID user(String phone) {
    UUID userId = UUID.randomUUID();
    scratch.update(
        "INSERT INTO users (user_id, phone, password_hash, name, terms_accepted_at) VALUES"
            + " (?, ?, 'x', 'Phone User', now())",
        userId,
        phone);
    return userId;
  }

  private String phoneOf(UUID userId) {
    return scratch.queryForObject(
        "SELECT phone FROM users WHERE user_id = ?", String.class, userId);
  }
}
