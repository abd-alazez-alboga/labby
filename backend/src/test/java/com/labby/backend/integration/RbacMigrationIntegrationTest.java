package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.labby.backend.enums.Permission;
import com.labby.backend.runner.RbacCatalogSeeder;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * M3-T1 acceptance: V4 migrates cleanly (context boot), Super Admin + Support are seeded, the DB
 * catalog mirrors the code catalog, the seed is idempotent, the audit log is append-only at the DB
 * level, and the one-role-per-admin CHECK holds.
 */
class RbacMigrationIntegrationTest extends AbstractIntegrationTest {

  private static final String SUPER_ADMIN_ID = "00000000-0000-0000-0000-000000000001";
  private static final String SUPPORT_ID = "00000000-0000-0000-0000-000000000002";

  @Autowired private JdbcTemplate jdbcTemplate;
  @Autowired private RbacCatalogSeeder rbacCatalogSeeder;

  @AfterEach
  void cleanOwnRows() {
    // audit_log rows are undeletable by design (append-only trigger) and reference users, so
    // they would poison other suites' `DELETE FROM users` cleanup in the shared container.
    // TRUNCATE bypasses row-level triggers; then this class's own fixtures can be removed.
    jdbcTemplate.execute("TRUNCATE audit_log");
    jdbcTemplate.update(
        "DELETE FROM role_assignments WHERE user_id IN"
            + " (SELECT user_id FROM users WHERE name = 'RBAC Test User')");
    jdbcTemplate.update("DELETE FROM users WHERE name = 'RBAC Test User'");
  }

  @Test
  @DisplayName("Super Admin and Support are seeded as system roles")
  void shouldSeedSystemRoles() {
    List<String> systemRoles =
        jdbcTemplate.queryForList(
            "SELECT name FROM roles WHERE is_system = true ORDER BY name", String.class);

    assertThat(systemRoles).containsExactly("Super Admin", "Support");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM roles WHERE role_id = ?::uuid AND name = 'Super Admin'",
                Integer.class,
                SUPER_ADMIN_ID))
        .isEqualTo(1);
  }

  @Test
  @DisplayName("the DB permission catalog mirrors the code catalog exactly")
  void shouldMirrorCodeCatalogInDatabase() {
    List<String> dbCodes =
        jdbcTemplate.queryForList("SELECT code FROM permissions ORDER BY code", String.class);
    List<String> codeCodes =
        Arrays.stream(Permission.values()).map(Permission::getValue).sorted().toList();

    assertThat(dbCodes).isEqualTo(codeCodes);
  }

  @Test
  @DisplayName(
      "Super Admin holds the full catalog; Support holds its RBAC-04 subset (+ regions:view V16,"
          + " reports V17)")
  void shouldGrantSeededRolesCorrectly() {
    Integer superAdminGrants =
        jdbcTemplate.queryForObject(
            "SELECT count(*) FROM role_permissions WHERE role_id = ?::uuid",
            Integer.class,
            SUPER_ADMIN_ID);
    List<String> supportGrants =
        jdbcTemplate.queryForList(
            "SELECT p.code FROM role_permissions rp JOIN permissions p ON p.permission_id ="
                + " rp.permission_id WHERE rp.role_id = ?::uuid ORDER BY p.code",
            String.class,
            SUPPORT_ID);

    assertThat(superAdminGrants).isEqualTo(Permission.values().length);
    assertThat(supportGrants)
        .containsExactly(
            "regions:view",
            "reports:handle",
            "reports:view",
            "rides:view",
            "support:handle",
            "support:view",
            "users:view");
  }

  @Test
  @DisplayName("re-running the catalog seeder changes nothing")
  void shouldBeIdempotentWhenSeederRunsAgain() {
    Integer permissionsBefore =
        jdbcTemplate.queryForObject("SELECT count(*) FROM permissions", Integer.class);
    Integer grantsBefore =
        jdbcTemplate.queryForObject("SELECT count(*) FROM role_permissions", Integer.class);

    rbacCatalogSeeder.run(null);

    assertThat(jdbcTemplate.queryForObject("SELECT count(*) FROM permissions", Integer.class))
        .isEqualTo(permissionsBefore);
    assertThat(jdbcTemplate.queryForObject("SELECT count(*) FROM role_permissions", Integer.class))
        .isEqualTo(grantsBefore);
  }

  @Test
  @DisplayName("audit_log rejects UPDATE and DELETE at the DB level")
  void shouldRejectMutationOfAuditLogRows() {
    UUID actorId = insertUser("+963911111001");
    jdbcTemplate.update(
        "INSERT INTO audit_log (actor_user_id, action, target_type, target_id) VALUES (?, 'test.action', 'test', 't1')",
        actorId);

    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE audit_log SET action = 'tampered' WHERE action = 'test.action'"))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("append-only");
    assertThatThrownBy(
            () -> jdbcTemplate.update("DELETE FROM audit_log WHERE action = 'test.action'"))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("append-only");
  }

  @Test
  @DisplayName("admin role assignments require exactly one RBAC role; non-admin rows refuse one")
  void shouldEnforceAdminRoleCheck() {
    UUID adminWithout = insertUser("+963911111002");
    UUID riderWith = insertUser("+963911111003");

    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO role_assignments (user_id, role, state) VALUES (?, 'admin', 'active')",
                    adminWithout))
        .isInstanceOf(DataAccessException.class);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO role_assignments (user_id, role, state, admin_role_id) VALUES"
                        + " (?, 'rider', 'active', ?::uuid)",
                    riderWith,
                    SUPER_ADMIN_ID))
        .isInstanceOf(DataAccessException.class);

    jdbcTemplate.update(
        "INSERT INTO role_assignments (user_id, role, state, admin_role_id) VALUES"
            + " (?, 'admin', 'active', ?::uuid)",
        adminWithout,
        SUPER_ADMIN_ID);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM role_assignments WHERE user_id = ? AND role = 'admin'",
                Integer.class,
                adminWithout))
        .isEqualTo(1);
  }

  private UUID insertUser(String phone) {
    UUID userId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO users (user_id, phone, password_hash, name, terms_accepted_at) VALUES"
            + " (?, ?, 'x', 'RBAC Test User', now())",
        userId,
        phone);
    return userId;
  }
}
