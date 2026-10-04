# Labby Backend

Spring Boot 3 / Java 21 API for Labby. Single Maven module, package-by-layer
(`com.labby.backend.{config,controller,dto,enums,exception,model,repository,runner,security,service,util}`),
structure per `docs/PROJECT-STRUCTURE.md` and enforced by ArchUnit
(`src/test/java/.../architecture/LayeredArchitectureTest.java`).

PostgreSQL with **Flyway owning the schema** (`ddl-auto: validate`,
migrations in `src/main/resources/db/migration/`). No Keycloak — Labby ships
its own phone+password auth in M2; there is no Spring Security yet.

## Prerequisites

- JDK 21+ (Maven comes via the wrapper, `./mvnw`)
- Docker + Docker Compose (local Postgres and Testcontainers-based tests)

## Run locally

```bash
# 1. Start Postgres (uses defaults from .env.example; export overrides as needed)
docker compose up -d --wait        # or: make db-up

# 2. Run the app with the dev profile (readable logs)
SPRING_PROFILES_ACTIVE=dev ./mvnw spring-boot:run   # or: make run
```

Then:

- Health: <http://localhost:8080/actuator/health>
- Swagger UI: <http://localhost:8080/swagger-ui.html>
- OpenAPI JSON: <http://localhost:8080/v3/api-docs>

## Configuration

Every setting in `application.yml` is `${ENV_VAR:default}`; all variables are
documented in [`.env.example`](.env.example) and default to a working local
setup. Profiles: `dev` (readable console logs, verbose app logging) and `prod`
(JSON logs via logstash encoder, no stack traces in responses). Never commit a
real `.env` — secrets live in the environment only.

## Make targets

| Target | What it does |
|---|---|
| `make help` | List targets (default) |
| `make check` | Full gate: google-java-format check + Checkstyle + unit, integration and ArchUnit tests (`mvnw verify`) |
| `make fix` | Auto-format sources (`spotless:apply`) |
| `make test` | Test suite only |
| `make build` | Runnable jar without tests |
| `make run` | `spring-boot:run` with the dev profile |
| `make db-up` / `make db-down` | Start/stop the compose Postgres |

The root-level `make backend-check|test|build` delegates here.

## Tests

- `architecture/` — ArchUnit rules (fixed package allowlist, layer access,
  naming, no field injection). They fail the build on violation.
- `integration/` — extend `AbstractIntegrationTest`: boots the app on a random
  port against one shared PostgreSQL Testcontainer (needs Docker).
- `unit/<layer>/` — plain JUnit 5 + Mockito + AssertJ tests mirroring the main
  layers.

Formatting (google-java-format via Spotless) and Checkstyle run on `verify`
and fail the build on drift; `make fix` repairs formatting.
