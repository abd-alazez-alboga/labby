package com.labby.backend.runner;

import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Dev-profile seeder per backend/docs/SEEDING.md (AUTH-07): pre-verified accounts inserted as DATA
 * — no OTP code path is bypassed. Idempotent: inserts only missing accounts, never updates existing
 * rows, so local changes survive restarts. Uses JdbcTemplate so the runner layer does not depend on
 * repositories (ArchUnit: repositories are service-layer-only).
 */
@Slf4j
@Component
@Profile("dev")
@RequiredArgsConstructor
public class DevDataSeeder implements ApplicationRunner {

  private record SeedAccount(String phone, String name, List<String> roles) {}

  private static final String SEED_PASSWORD = "Password1!";
  private static final List<SeedAccount> SEED_ACCOUNTS =
      List.of(
          new SeedAccount("+963900000001", "Dev Rider", List.of("rider")),
          new SeedAccount("+963900000002", "Dev Driver", List.of("rider", "driver")),
          new SeedAccount("+963900000003", "Dev Rider NoDriver", List.of("rider")),
          new SeedAccount("+963900000004", "Dev Admin", List.of("admin")));

  private final JdbcTemplate jdbcTemplate;
  private final PasswordEncoder passwordEncoder;

  @Override
  @Transactional
  public void run(ApplicationArguments args) {
    for (SeedAccount account : SEED_ACCOUNTS) {
      Integer existing =
          jdbcTemplate.queryForObject(
              "SELECT count(*) FROM users WHERE phone = ?", Integer.class, account.phone());
      if (existing != null && existing > 0) {
        continue;
      }
      UUID userId = UUID.randomUUID();
      jdbcTemplate.update(
          "INSERT INTO users (user_id, phone, password_hash, name, language, state)"
              + " VALUES (?, ?, ?, ?, 'en', 'active')",
          userId,
          account.phone(),
          passwordEncoder.encode(SEED_PASSWORD),
          account.name());
      for (String role : account.roles()) {
        jdbcTemplate.update(
            "INSERT INTO role_assignments (user_id, role, state) VALUES (?, ?, 'active')",
            userId,
            role);
      }
      log.info("Seeded dev account {} ({})", account.phone(), String.join("+", account.roles()));
    }
  }
}
