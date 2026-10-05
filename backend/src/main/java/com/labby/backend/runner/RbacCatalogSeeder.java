package com.labby.backend.runner;

import com.labby.backend.enums.Permission;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Syncs the code-side permission catalog ({@link Permission}) into the {@code permissions} table on
 * every boot, all profiles — idempotent by construction (M3-T1 AC). Inserts only what is missing
 * and re-completes Super Admin's grant so it always holds the full catalog (RBAC-01). Support (and
 * every other role) is NEVER touched here: Support is editable (RBAC-04) and re-seeding its grants
 * would revert owner edits. Removals go through migrations. Uses JdbcTemplate so the runner layer
 * does not depend on repositories (ArchUnit).
 */
@Slf4j
@Component
@Order(1)
@RequiredArgsConstructor
public class RbacCatalogSeeder implements ApplicationRunner {

  private static final String SUPER_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";

  private final JdbcTemplate jdbcTemplate;

  @Override
  @Transactional
  public void run(ApplicationArguments args) {
    int inserted = 0;
    for (Permission permission : Permission.values()) {
      inserted +=
          jdbcTemplate.update(
              "INSERT INTO permissions (code, domain) VALUES (?, ?) ON CONFLICT (code) DO NOTHING",
              permission.getValue(),
              permission.getDomain());
    }
    int granted =
        jdbcTemplate.update(
            "INSERT INTO role_permissions (role_id, permission_id) SELECT ?::uuid, permission_id"
                + " FROM permissions ON CONFLICT DO NOTHING",
            SUPER_ADMIN_ROLE_ID);
    if (inserted > 0 || granted > 0) {
      log.info(
          "RBAC catalog sync: {} permissions added, {} Super Admin grants added",
          inserted,
          granted);
    }
  }
}
