package com.labby.backend.integration;

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
  }
}
