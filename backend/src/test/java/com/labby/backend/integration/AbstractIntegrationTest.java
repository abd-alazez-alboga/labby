package com.labby.backend.integration;

import java.nio.file.Path;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * Base class for integration tests: boots the full application on a random port against a single
 * PostgreSQL Testcontainer that is started once and shared by every subclass. The image is the
 * PostGIS build, matching docker-compose.yml — V5 enables the extension for region geometry.
 */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
public abstract class AbstractIntegrationTest {

  private static final PostgreSQLContainer<?> POSTGRES =
      new PostgreSQLContainer<>(
              DockerImageName.parse("postgis/postgis:16-3.4-alpine")
                  .asCompatibleSubstituteFor("postgres"))
          .withDatabaseName("labby_test")
          .withUsername("labby")
          .withPassword("labby");

  static {
    POSTGRES.start();
  }

  @DynamicPropertySource
  static void databaseProperties(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
    // application.yml deliberately has no jwt-secret default; tests supply their own.
    registry.add("labby.auth.jwt-secret", () -> "labby-integration-test-secret-0123456789abcdef");
    // Private uploads go to a temp dir, never into the working tree.
    registry.add(
        "labby.storage.dir",
        () -> Path.of(System.getProperty("java.io.tmpdir"), "labby-it-uploads").toString());
    // The daily expiry job never fires on its own in tests; they call its service on a
    // controlled clock (M5-T2).
    registry.add("labby.onboarding.expiry-job-cron", () -> "-");
    // The notification dispatcher never fires on its own either; tests call it directly (M6-T2).
    registry.add("labby.notifications.dispatch-cron", () -> "-");
    // Nor do the ride dispatcher and monitor: ride tests advance them on a controlled clock (M7).
    registry.add("labby.rides.dispatch-cron", () -> "-");
    registry.add("labby.rides.monitor-cron", () -> "-");
    // The weekly commission recalc fires only when tests call it on their controlled clock (M8).
    registry.add("labby.money.commission-recalc-cron", () -> "-");
    // The surge cycle runs only when tests call SurgeService.recompute on their clock (M9).
    registry.add("labby.surge.cycle-cron", () -> "-");
    // The M11 rating-snapshot and metric-warning jobs run only when tests call their services.
    registry.add("labby.trust.rating-snapshot-cron", () -> "-");
    registry.add("labby.trust.metric-warning-cron", () -> "-");
    // Tests never call the public OSRM server: the discard port refuses connections, so routing
    // takes the straight-line fallback unless a test points the URL at its own stub (M6-T3).
    registry.add("labby.routing.osrm-url", () -> "http://127.0.0.1:9");
  }
}
