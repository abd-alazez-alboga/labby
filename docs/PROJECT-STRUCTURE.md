# Project Structure Template

Reusable structure extracted from the Regardian backend (Spring Boot) and frontend (Angular + Nx). Placeholders use `<feature>` / `<domain>`; Regardian names appear only as examples.

---

# Backend (Spring Boot)

Single Maven module, **package-by-layer** (not package-by-feature). A feature is spread horizontally across fixed layer packages. The layout is enforced by an ArchUnit test.

## Stack

| Concern | Choice |
|---|---|
| Framework | Spring Boot 3.x (Spring MVC, servlet), Java 21+ |
| Build | Maven + wrapper (`mvnw`); version in `pom.xml` mirrored in root `VERSION` file (CI checks they match) |
| DB | PostgreSQL + Spring Data JPA; **Flyway owns the schema** (`ddl-auto: validate`) |
| Auth | OAuth2 resource server (JWT from Keycloak), method security (`@PreAuthorize`) |
| Mapping | MapStruct (`componentModel=spring`) + Lombok (annotation processors wired together) |
| API docs | springdoc-openapi (Swagger UI), scans only the `controller` package |
| Logging | Logback + logstash encoder (JSON structured logs), `logback-spring.xml` |
| Tests | JUnit 5, Mockito, AssertJ, MockMvc, Testcontainers, ArchUnit |
| Quality | google-java-format (fails build on `verify`), Checkstyle, git pre-commit hook |

## Directory tree

```
backend/
├── pom.xml  mvnw  VERSION  Makefile  Dockerfile  Dockerfile.runtime
├── .githooks/pre-commit          # format + checkstyle, installed via make install-hooks
├── .env.example                  # documents every env var
├── docs/                         # CONTRIBUTING, TESTING, CONFIGURATION, LOGGING, VERSIONING...
├── assets/                       # seed/import files, copied to classpath
└── src/
    ├── main/
    │   ├── java/com/<org>/<app>/
    │   │   ├── <App>Application.java
    │   │   ├── config/        # @Configuration: Security, CORS, OpenAPI, props classes, filters
    │   │   ├── controller/    # @RestController only
    │   │   ├── dto/           # request/response DTOs (flat)
    │   │   ├── enums/         # domain enums
    │   │   ├── exception/     # custom exceptions + GlobalExceptionHandler
    │   │   ├── model/         # JPA @Entity classes
    │   │   ├── repository/    # Spring Data interfaces
    │   │   │   └── projection/  # record projections (*Row) for aggregate queries
    │   │   ├── runner/        # ApplicationRunner seeders, profile-gated
    │   │   ├── security/      # JwtAuthConverter, SecurityUtils, filters
    │   │   │   └── crypto/    # AES cipher + JPA AttributeConverter for encrypted columns
    │   │   ├── service/       # XxxService interface + XxxServiceImpl + helper collaborators
    │   │   └── util/          # MapStruct mappers, enum JPA converters, parsers
    │   └── resources/
    │       ├── application.yml            # every value is ${ENV_VAR:default}
    │       ├── application-dev.yml / application-prod.yml
    │       ├── logback-spring.xml
    │       └── db/migration/V{N}__snake_case_description.sql
    └── test/
        ├── java/com/<org>/<app>/
        │   ├── architecture/   # ArchUnit LayeredArchitectureTest
        │   ├── integration/    # XxxIntegrationTest + AbstractIntegrationTest (Testcontainers)
        │   └── unit/<layer>/   # mirrors main layers: unit/service/, unit/controller/, unit/util/...
        └── resources/          # test application.properties, archunit.properties, fixtures
```

Every top-level package gets a `package-info.java` with one line of Javadoc.

## One feature = one file per layer

For a resource `<Feature>` (example: `AssetCategory`):

| Layer | File | Pattern |
|---|---|---|
| Controller | `controller/<Feature>Controller.java` | `@RestController @RequestMapping("/api/<kebab-plural>")`, `@Tag`, per-method `@Operation`/`@ApiResponses`, `@Valid @RequestBody`, returns `ResponseEntity<...Dto>` (201/200/204), optional `@PreAuthorize("hasAuthority('<domain>:<action>')")` |
| Service | `service/<Feature>Service.java` | interface; takes and returns **DTOs only** |
| Impl | `service/<Feature>ServiceImpl.java` | `@Service @Transactional` (class), `@Transactional(readOnly=true)` on reads; injects repos + mapper; throws `BusinessException` subclasses |
| Repository | `repository/<Feature>Repository.java` | `interface extends JpaRepository<Entity, UUID>`; derived queries + `@Query` JPQL |
| Entity | `model/<Feature>.java` | see entity conventions |
| Mapper | `util/<Feature>Mapper.java` | MapStruct interface: `toEntity`, `toResponseDto`, `toResponseDtoList`, `toBriefDto`, `updateEntityFromDto(@MappingTarget ...)` |
| DTOs | `dto/<Feature>RequestDto / ResponseDto / ListResponseDto / BriefDto` | Lombok `@Data @Builder @NoArgsConstructor @AllArgsConstructor` + Jakarta validation; list DTO is a `record(List<...> items, long totalCount)` |
| Migration | `db/migration/V{N}__<feature>.sql` | sequential integers |
| Tests | `unit/service/<Feature>ServiceImplTest`, `integration/<Feature>IntegrationTest` | |

Bigger features add collaborators next to the Impl (`*Assembler`, `*Validator`, `*Resolver`, `*Query`), enums in `enums/` with a `@Converter(autoApply=true)` in `util/`, and seeders in `runner/`.

## Conventions

**Request flow:** filters → security chain (JWT → authorities) → Controller → Service interface → ServiceImpl (`@Transactional`) → Repository → Entity, with Mapper translating DTO↔Entity at the service boundary. Errors bubble to `GlobalExceptionHandler` (`@RestControllerAdvice`).

**ArchUnit rules (fail the build):**
- Fixed allowlist of top-level packages — adding a package requires updating the test.
- No layer accesses `controller`; `repository` is accessed only by `service`/`repository`.
- `dto` must not depend on `model` or `repository`.
- `@RestController` classes end in `Controller`; `repository` interfaces end in `Repository`.
- No `@Autowired` field injection — constructor injection (`@RequiredArgsConstructor` + `final` fields).

**Entities:**
- `@Entity @Table(name="snake_case")`, UUID PK, column `<entity>_id`.
- Soft delete: `@SQLDelete(... SET deleted_at = now() ...)` + `@SQLRestriction("deleted_at IS NULL")`.
- Audit columns `created_at/updated_at/created_by/updated_by/deleted_at` set in `@PrePersist`/`@PreUpdate`.
- `equals`/`hashCode` on id only. Optional `@Version` for optimistic locking.
- Avoid `@Data` and `@AllArgsConstructor` on entities (use `@Getter @Setter @NoArgsConstructor @Builder`).

**Enums:** lowercase DB `value`, `getValue()`, static case-insensitive `fromValue(String)`, paired `@Converter(autoApply=true)` in `util/`, registered for `@RequestParam` binding in a `WebMvcConfigurer`.

**Exceptions:** abstract `BusinessException extends RuntimeException` carrying an `HttpStatus`; subclasses like `ResourceNotFoundException(resourceType, id)` → 404, `ResourceAlreadyExistsException`, `BusinessRuleViolationException`, `StaleVersionException`. `GlobalExceptionHandler` maps them plus validation errors (field→message map), 409 on optimistic lock, catch-all 500.

**Config:** deny-by-default `SecurityConfig` with a public whitelist (health, auth, swagger); stateless, CSRF off; `SECURITY_AUTH_DISABLED` switch for dev/tests. `@ConfigurationProperties` classes per prefix. Profiles: default/`dev`/`prod`; every value `${ENV_VAR:default}` documented in `.env.example`.

**Tests:**
- Unit: `unit/<layer>/<Class>Test`; services use `@Mock` repos + `@Spy` real MapStruct mapper + `@InjectMocks`; controllers use `@WebMvcTest` with security auto-config excluded.
- Integration: `<Feature>IntegrationTest extends AbstractIntegrationTest` — `@SpringBootTest(RANDOM_PORT)`, one static reused `PostgreSQLContainer`, `@DynamicPropertySource`, auth disabled with a permissive test `JwtDecoder`, `@AfterEach` cleanup via `JdbcTemplate`.
- Method names: `shouldDoXWhenY()` + `@DisplayName`, AAA, AssertJ.

**Makefile targets:** `help` (default, self-documenting), `check` (format-check + checkstyle + `verify`), `fix`, `test`, `build`, `install-hooks`. Docker: multi-stage build image + a slim `Dockerfile.runtime` that takes a CI-built jar; non-root user; `HEALTHCHECK` on `/actuator/health`.

**Fix in a new project** (known inconsistencies in the source repo): version all APIs (`/api/v1/...`) or none; consider a dedicated `mapper/` package instead of `util/`; start ArchUnit rules unfrozen; add JaCoCo/NullAway if you want full enforcement; use records or `@Value` for DTOs.

---

# Frontend (Angular + Nx)

Nx integrated monorepo. **One thin app + domain-sliced libraries**, with layer/domain tags enforced by `@nx/enforce-module-boundaries`.

## Stack

| Concern | Choice |
|---|---|
| Framework | Angular 20 — standalone components only, signals, `inject()`, functional guards, new control flow |
| Monorepo | Nx (integrated), libs consumed as source via TS path aliases (no lib builds) |
| State | No store library: root-provided **signal facades** in domain libs + component-scoped `*.store.ts` in features |
| UI | Angular Material/CDK wrapped by an in-house `ui-components` lib (`lib-` prefix); Lucide icons |
| Styling | SCSS design-system lib (tokens/mixins/themes → CSS custom properties); light/dark via body class; Stylelint bans raw px ≥10 to force tokens |
| i18n | Transloco + messageformat; runtime-loaded `/assets/i18n/{lang}.json`; RTL via a custom `Directionality` |
| Auth | Keycloak (`keycloak-angular`), bearer interceptor scoped to API URLs |
| Tests | Jest (per-project configs) + Cypress e2e app |
| Quality | ESLint flat config, Prettier, Stylelint, Husky + lint-staged, knip |

## Monorepo tree

```
frontend/
├── nx.json  package.json  tsconfig.base.json  jest.config.ts  jest.preset.js
├── eslint.config.mjs  knip.json  Makefile  dockerfile  nginx.conf  entrypoint.sh
├── tools/                 # workspace tooling (e.g. MCP helpers)
├── types/                 # ambient .d.ts shims (in tsconfig typeRoots)
├── apps/
│   ├── <app>/             # the single SPA            tags: type:app
│   └── <app>-e2e/         # Cypress
└── libs/
    ├── <domain>/                          # one folder per business domain
    │   ├── domain-<domain>-management/    # type:domain-logic — entities, API, mappers, facades
    │   ├── feature-<domain>-management/   # type:feature      — routed pages, routes, stores
    │   ├── ui-<domain>-management/        # type:ui           — dumb domain components
    │   └── util-<domain>-management/      # type:util         — provideXxx() helpers (optional)
    └── shared/
        ├── ui-components/                 # generic design-system Angular components
        ├── ui-design-system/              # SCSS only: tokens, mixins, themes, utilities
        └── util-services/                 # config, auth, guards, BaseApiService, i18n, error/log
```

- Minimum per domain: `domain-` + `feature-`; add `ui-`/`util-` when needed.
- Each lib gets two tags: `type:` (`app|feature|ui|domain-logic|util`) and `domain:` (`shared|<domain>`). Libs reused across domains are tagged `domain:shared`.
- Import alias = `@<scope>/<layer>-<domain>-management`; shared libs use `@<scope>/shared/<lib>`. All aliases in `tsconfig.base.json`, each pointing at the lib's `src/index.ts`.
- Register Nx generator defaults in `nx.json` so new libs get directory, prefix, tags, and importPath preset.

## Lib internals

**Domain lib** (data access, no UI):
```
domain-<d>-management/src/
├── index.ts                       # single public barrel
└── lib/
    ├── entities/                  # domain models/interfaces (+ index.ts)
    ├── infrastructure/            # <x>.api.service.ts (extends BaseApiService, URL from RUNTIME_CONFIG)
    │                              # <x>.dto.ts, <x>.dto-mapping.ts (DTO→entity fns)
    ├── mappers/                   # *.mapper.ts
    ├── facades/                   # <d>.facade.ts — @Injectable root, private signal()s exposed
    │                              # via .asReadonly()/computed(); calls API services
    └── ports/                     # InjectionTokens / abstract ports (optional)
```

**Feature lib** (routed smart UI):
```
feature-<d>-management/src/
├── index.ts                       # exports shell component + <D>_ROUTES
├── ai.ts                          # optional secondary entry: eager providers only
├── testing/                       # spec helpers
└── lib/
    ├── feature-<d>.ts             # shell: <router-outlet/> host
    ├── feature-<d>.routes.ts      # exported UPPER_SNAKE Route[] constant
    ├── components/                # feature-private components
    └── <page>/                    # one folder per routed page
        ├── <page>.ts / .html / .scss / .spec.ts     # class suffix "Page"
        └── <child>/ *.component.ts, *.store.ts, *.types.ts
```

**UI lib:** one folder per presentational component (`lib/<name>/<name>.component.ts|html|scss|spec.ts`, `<name>.types.ts`, `index.ts`) + a barrel. In `ui-components`, group the barrel exports under section comments (PRIMITIVES, LAYOUT, FORMS, FEEDBACK, OVERLAYS, ...).

**Util lib:** `lib/*.providers.ts` exposing `provideXxx()` functions.

## App internals

```
apps/<app>/src/
├── main.ts                 # await loadRuntimeConfig() → createAppConfig() → bootstrapApplication();
│                           # fatal-error page on failure
├── app/
│   ├── app.config.ts       # createAppConfig(runtimeConfig): ApplicationConfig FACTORY —
│   │                       # router, http+interceptors, i18n, Keycloak, RUNTIME_CONFIG token, icons
│   ├── app.routes.ts       # role-based '' redirect; each domain lazy-loaded:
│   │                       # loadChildren: () => import('@scope/feature-x').then(r => r.X_ROUTES)
│   │                       # canActivate: [AuthGuard, permissionGuard()], data: { permissions: ['x:read'] }
│   ├── app.ts|html|scss    # root layout: sidenav + navbar + breadcrumb + <router-outlet>
│   └── shell/              # app-only chrome: navbar/, sidebar/ (nav config file), footer/, dashboard/
├── environments/           # only select WHICH runtime config file to load (fileReplacements)
├── assets/
│   ├── config/config*.json # RUNTIME config; Docker entrypoint envsubst's the template
│   ├── i18n/{en,ar}.json   # all translations in one place, keys nested per feature
│   └── theme/ fonts/ ...
├── testing/                # transloco test module preloaded with real en.json, mocks
└── styles.scss             # @use the design-system lib
```

## Conventions

**Module boundaries** (ESLint `@nx/enforce-module-boundaries`):
- `type:app` → feature, ui, util
- `type:feature` → ui, domain-logic, util
- `type:ui` → ui, domain-logic, util
- `type:domain-logic` → util only
- `type:util` → domain-logic, util
- `domain:shared` → shared only; a specific `domain:x` → its own domain + shared

**Naming:** kebab-case files; suffixes `*.api.service.ts`, `*.facade.ts`, `*.store.ts`, `*.mapper.ts`, `*.dto.ts`, `*.types.ts`, `*.routes.ts`, `*.guard.ts`, `*.providers.ts`, `*.token.ts`, `*.spec.ts`. Selector prefix `app-` in the app, `lib-` in libs (enforced per-project by angular-eslint). Routes exported as `X_ROUTES: Route[]`.

**Cross-cutting homes** (all in `libs/shared/util-services`): `config/` (RuntimeConfig type + `RUNTIME_CONFIG` token + loader), `auth/` + `guards/` (Keycloak auth guard, `permissionGuard()` reading JWT claims against route `data.permissions`, permission structural directive), `services/base-api.service.ts` (abstract HTTP base all API services extend), i18n setup (provider, loader, language service, directionality), `error/` + `log/`.

**Runtime config over build-time env:** the app fetches `config.json` at boot; Docker generates it with envsubst. `environments/*` only pick the config file. This makes one image deployable to every environment.

**Tests:** Jest config per project (`displayName`, shared `jest.preset.js`, `src/test-setup.ts`); specs colocated as `*.spec.ts` (variant specs use dotted qualifiers, e.g. `x.role-gates.spec.ts`); shared helpers in `src/testing/`. E2E app organized `src/e2e/<area>/*.cy.ts` + `support/` + `fixtures/`, target env selected by variable.

**Quality gates:** Husky pre-commit (lint-staged: eslint→prettier for TS, stylelint→prettier for SCSS), Makefile `check` = format:check + lint + stylelint + test:ci, CI runs `nx affected -t lint,test`. knip for dead code. `VERSION` file checked against package.json in CI.

---

# Shared patterns across both repos

- Root files every service repo carries: `Makefile` (self-documenting `help` default; `check`/`fix`/`test`/`build`/`install-hooks`), `VERSION` (CI-verified against the manifest), `Dockerfile.runtime` (slim image consuming the CI-built artifact), `docs/`, `.env.example` or config template.
- Permissions use the same `"<domain>:<action>"` string on both sides: `@PreAuthorize("hasAuthority('framework:read')")` in the backend ↔ `data: { permissions: ['framework:read'] }` on the frontend route.
- Architecture is enforced by tooling, not convention docs: ArchUnit (backend) and Nx module boundaries (frontend).
- Git hooks auto-format before commit; CI re-checks formatting and fails on drift.
