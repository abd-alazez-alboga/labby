package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.dto.AuthTokensResponseDto;
import com.labby.backend.enums.ClientType;
import com.labby.backend.util.RbacIds;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M4-T2 acceptance: region activation is blocked while the mandatory bundle is incomplete (UC-A-05
 * E1, the 409 lists what is missing), resolve-region is correct at boundaries (SD-01, point ON the
 * edge resolves; shared borders break ties by name), boundaries may not overlap, zones must lie
 * within their region, the client config hides drafts and disabled service types, every admin
 * mutation is permission-gated (RBAC-03) and audited (RBAC-05).
 */
class RegionsAdminIntegrationTest extends AbstractAuthIntegrationTest {

  private static final String PASSWORD = "Secret123!";

  @AfterEach
  void cleanRegionRows() {
    // Runs before the parent's cleanDatabase: children first, then regions (FK order).
    jdbcTemplate.update("DELETE FROM surge_zones");
    jdbcTemplate.update("DELETE FROM surcharge_windows");
    jdbcTemplate.update("DELETE FROM service_types");
    jdbcTemplate.update("DELETE FROM regions");
  }

  private AuthTokensResponseDto registerAdmin(String phone, UUID roleId) {
    AuthTokensResponseDto session = register(phone, PASSWORD, "Admin " + phone);
    jdbcTemplate.update(
        "INSERT INTO role_assignments (user_id, role, state, admin_role_id)"
            + " VALUES (?, 'admin', 'active', ?)",
        session.user().id(),
        roleId);
    return login(phone, PASSWORD, ClientType.ADMIN);
  }

  private ResponseEntity<String> get(String url, String token) {
    HttpHeaders headers = token == null ? new HttpHeaders() : bearer(token);
    return restTemplate.exchange(url, HttpMethod.GET, new HttpEntity<>(headers), String.class);
  }

  private ResponseEntity<String> send(String url, HttpMethod method, Object body, String token) {
    return restTemplate.exchange(url, method, authorized(body, token), String.class);
  }

  private ResponseEntity<Map<String, Object>> sendForMap(
      String url, HttpMethod method, Object body, String token) {
    return restTemplate.exchange(
        url, method, authorized(body, token), new ParameterizedTypeReference<>() {});
  }

  private static Map<String, Object> polygon(
      double minLng, double minLat, double maxLng, double maxLat) {
    return Map.of(
        "type",
        "Polygon",
        "coordinates",
        List.of(
            List.of(
                List.of(minLng, minLat),
                List.of(maxLng, minLat),
                List.of(maxLng, maxLat),
                List.of(minLng, maxLat),
                List.of(minLng, minLat))));
  }

  private static Map<String, Object> fullBundle(String name, Map<String, Object> boundary) {
    Map<String, Object> bundle = new HashMap<>();
    bundle.put("name", name);
    bundle.put("boundary", boundary);
    bundle.put("currency", "SYP");
    bundle.put("emergencyNumber", "112");
    bundle.put("cancellationGraceMin", 5);
    bundle.put("cancellationFee", 1.00);
    bundle.put("waitGraceMin", 5);
    bundle.put("waitPerMinRate", 0.25);
    bundle.put("pickupFeeThresholdKm", 10.0);
    bundle.put("pickupFeePerKm", 0.50);
    bundle.put("surgeCap", 3.0);
    bundle.put(
        "commissionTiers",
        List.of(
            Map.of("weeklyTripsAbove", 0, "percent", 25),
            Map.of("weeklyTripsAbove", 100, "percent", 20)));
    bundle.put(
        "incentiveValues",
        Map.of(
            "weeklyTripBonuses",
            List.of(Map.of("trips", 40, "amount", 50)),
            "peakHourBonusPerTrip",
            1.0,
            "ratingReward",
            Map.of("amount", 20, "minAvgRating", 4.8, "minWeeklyTrips", 30)));
    bundle.put(
        "suspensionThresholds",
        Map.of(
            "driver", Map.of("minAvgRating", 3.0, "minRatedRides", 20),
            "rider", Map.of("minAvgRating", 2.5, "minRatedRides", 10)));
    return bundle;
  }

  private static Map<String, Object> serviceTypeBody(String nameEn, boolean enabled) {
    return Map.of(
        "nameEn", nameEn,
        "nameAr", "نوع",
        "baseFare", 1.00,
        "perKmRate", 0.30,
        "perMinRate", 0.05,
        "minimumFare", 1.50,
        "enabled", enabled);
  }

  private static Map<String, Object> zoneBody(String name, Map<String, Object> polygon) {
    return Map.of(
        "name",
        name,
        "polygon",
        polygon,
        "thresholdSteps",
        List.of(Map.of("ratio", 2, "multiplier", 1.2), Map.of("ratio", 3, "multiplier", 1.5)));
  }

  private static Map<String, Object> windowBody(String label, double percent) {
    return Map.of(
        "label",
        label,
        "startsAt",
        "07:30:00",
        "endsAt",
        "09:30:00",
        "daysOfWeek",
        List.of(1, 2, 3, 4, 5),
        "percent",
        percent);
  }

  private String createDraft(String token, Object body) {
    ResponseEntity<Map<String, Object>> created =
        sendForMap("/api/v1/admin/regions", HttpMethod.POST, body, token);
    assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    return String.valueOf(created.getBody().get("id"));
  }

  /** Full UC-A-05 happy path: draft with complete bundle, one enabled service type, activate. */
  private String createActiveRegion(
      String token, String name, double minLng, double minLat, double maxLng, double maxLat) {
    String regionId = createDraft(token, fullBundle(name, polygon(minLng, minLat, maxLng, maxLat)));
    assertThat(
            send(
                    "/api/v1/admin/regions/" + regionId + "/service-types",
                    HttpMethod.POST,
                    serviceTypeBody("Economy", true),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CREATED);
    ResponseEntity<String> activated =
        send("/api/v1/admin/regions/" + regionId + "/activate", HttpMethod.POST, null, token);
    assertThat(activated.getStatusCode()).isEqualTo(HttpStatus.OK);
    return regionId;
  }

  @Test
  @DisplayName("401 anonymous, 403 without regions:*/pricing:*, client endpoints need no admin")
  void shouldEnforcePermissionsPerEndpointGroup() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963934000001", RbacIds.SUPER_ADMIN_ROLE_ID);
    AuthTokensResponseDto support = registerAdmin("+963934000002", RbacIds.SUPPORT_ROLE_ID);
    AuthTokensResponseDto rider = register("+963934000003", PASSWORD, "Plain Rider");
    String supportToken = support.accessToken();
    UUID someId = UUID.randomUUID();

    assertThat(get("/api/v1/admin/regions", null).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(get("/api/v1/regions/resolve?lat=33.0&lng=36.0", null).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);

    // Support holds neither regions:* nor pricing:* -> 403 on every admin group.
    assertThat(get("/api/v1/admin/regions", supportToken).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            send("/api/v1/admin/regions", HttpMethod.POST, Map.of("name", "X"), supportToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(get("/api/v1/admin/regions/" + someId, supportToken).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            send(
                    "/api/v1/admin/regions/" + someId,
                    HttpMethod.PUT,
                    Map.of("name", "X"),
                    supportToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            send(
                    "/api/v1/admin/regions/" + someId + "/activate",
                    HttpMethod.POST,
                    null,
                    supportToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            get("/api/v1/admin/regions/" + someId + "/service-types", supportToken).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            send(
                    "/api/v1/admin/regions/" + someId + "/service-types",
                    HttpMethod.POST,
                    serviceTypeBody("Economy", true),
                    supportToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            send(
                    "/api/v1/admin/service-types/" + someId,
                    HttpMethod.PUT,
                    serviceTypeBody("Economy", true),
                    supportToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            get("/api/v1/admin/regions/" + someId + "/surcharge-windows", supportToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            send(
                    "/api/v1/admin/regions/" + someId + "/surcharge-windows",
                    HttpMethod.POST,
                    windowBody("Rush", 25),
                    supportToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            send(
                    "/api/v1/admin/surcharge-windows/" + someId,
                    HttpMethod.PUT,
                    windowBody("Rush", 25),
                    supportToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            send("/api/v1/admin/surcharge-windows/" + someId, HttpMethod.DELETE, null, supportToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            get("/api/v1/admin/regions/" + someId + "/surge-zones", supportToken).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            send(
                    "/api/v1/admin/regions/" + someId + "/surge-zones",
                    HttpMethod.POST,
                    zoneBody("Old City", polygon(36.1, 33.1, 36.2, 33.2)),
                    supportToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            send(
                    "/api/v1/admin/surge-zones/" + someId,
                    HttpMethod.PUT,
                    zoneBody("Old City", polygon(36.1, 33.1, 36.2, 33.2)),
                    supportToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            send("/api/v1/admin/surge-zones/" + someId, HttpMethod.DELETE, null, supportToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);

    // With the permissions the group is allowed.
    assertThat(get("/api/v1/admin/regions", superAdmin.accessToken()).getStatusCode())
        .isEqualTo(HttpStatus.OK);

    // Client endpoints: any authenticated account, no admin role -> 404-s, never 403.
    assertThat(
            get("/api/v1/regions/resolve?lat=33.0&lng=36.0", rider.accessToken()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(get("/api/v1/regions/" + someId + "/config", rider.accessToken()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  @DisplayName("UC-A-05: draft -> activation 409 listing every missing part -> complete -> active")
  void shouldWalkDraftToActiveLifecycle() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963934000011", RbacIds.SUPER_ADMIN_ROLE_ID);
    AuthTokensResponseDto rider = register("+963934000012", PASSWORD, "Rider");
    String token = superAdmin.accessToken();

    // Only the name is mandatory at creation (E1: saved as draft).
    ResponseEntity<Map<String, Object>> created =
        sendForMap("/api/v1/admin/regions", HttpMethod.POST, Map.of("name", "Damascus"), token);
    assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    assertThat(created.getBody().get("state")).isEqualTo("draft");
    String regionId = String.valueOf(created.getBody().get("id"));

    // Activation is blocked and the 409 names every missing part.
    ResponseEntity<String> blocked =
        send("/api/v1/admin/regions/" + regionId + "/activate", HttpMethod.POST, null, token);
    assertThat(blocked.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(blocked.getBody())
        .contains("boundary")
        .contains("currency")
        .contains("emergency number")
        .contains("at least one enabled service type")
        .contains("cancellation values")
        .contains("wait values")
        .contains("pickup-fee values")
        .contains("commission tiers")
        .contains("incentive values")
        .contains("suspension thresholds")
        .contains("surge cap");

    // Fill the bundle; only the service type is still missing.
    assertThat(
            send(
                    "/api/v1/admin/regions/" + regionId,
                    HttpMethod.PUT,
                    fullBundle("Damascus", polygon(36.0, 33.0, 36.5, 33.5)),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);
    ResponseEntity<String> stillBlocked =
        send("/api/v1/admin/regions/" + regionId + "/activate", HttpMethod.POST, null, token);
    assertThat(stillBlocked.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(stillBlocked.getBody())
        .contains("at least one enabled service type")
        .doesNotContain("boundary");

    // A DISABLED service type does not count; an enabled one completes the bundle.
    assertThat(
            send(
                    "/api/v1/admin/regions/" + regionId + "/service-types",
                    HttpMethod.POST,
                    serviceTypeBody("Vans", false),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CREATED);
    assertThat(
            send("/api/v1/admin/regions/" + regionId + "/activate", HttpMethod.POST, null, token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(
            send(
                    "/api/v1/admin/regions/" + regionId + "/service-types",
                    HttpMethod.POST,
                    serviceTypeBody("Economy", true),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CREATED);

    ResponseEntity<Map<String, Object>> activated =
        sendForMap("/api/v1/admin/regions/" + regionId + "/activate", HttpMethod.POST, null, token);
    assertThat(activated.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(activated.getBody().get("state")).isEqualTo("active");
    assertThat(activated.getBody().get("serviceTypeCount")).isEqualTo(2);

    // Idempotent on an active region.
    assertThat(
            send("/api/v1/admin/regions/" + regionId + "/activate", HttpMethod.POST, null, token)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);

    // UC-A-06: an ACTIVE region may not un-fill mandatory config.
    ResponseEntity<String> stripped =
        send(
            "/api/v1/admin/regions/" + regionId, HttpMethod.PUT, Map.of("name", "Damascus"), token);
    assertThat(stripped.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(stripped.getBody()).contains("currency").contains("surge cap");

    // SD-01: the rider app resolves the active region from GPS.
    ResponseEntity<String> resolved =
        get("/api/v1/regions/resolve?lat=33.25&lng=36.25", rider.accessToken());
    assertThat(resolved.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(resolved.getBody())
        .contains(regionId)
        .contains("\"currency\":\"SYP\"")
        .contains("\"emergencyNumber\":\"112\"")
        .contains("Economy");
  }

  @Test
  @DisplayName("SD-01 edges: ON-boundary resolves, outside 404, shared border first by name")
  void shouldResolveCorrectlyAtBoundaries() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963934000021", RbacIds.SUPER_ADMIN_ROLE_ID);
    String token = superAdmin.accessToken();
    String alpha = createActiveRegion(token, "Alpha", 36.0, 33.0, 36.5, 33.5);
    String beta = createActiveRegion(token, "Beta", 36.5, 33.0, 37.0, 33.5);

    // A point exactly ON the edge counts as inside (pinned ST_Covers behavior, over HTTP).
    ResponseEntity<String> onEdge = get("/api/v1/regions/resolve?lat=33.0&lng=36.25", token);
    assertThat(onEdge.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(onEdge.getBody()).contains(alpha);

    // On the SHARED border both regions cover the point: first by name (Alpha) wins.
    ResponseEntity<String> sharedBorder = get("/api/v1/regions/resolve?lat=33.25&lng=36.5", token);
    assertThat(sharedBorder.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(sharedBorder.getBody()).contains(alpha).doesNotContain(beta);

    // Strictly inside Beta.
    ResponseEntity<String> insideBeta = get("/api/v1/regions/resolve?lat=33.25&lng=36.75", token);
    assertThat(insideBeta.getBody()).contains(beta);

    // Outside every region -> 404 (the apps' outside-operating-area state).
    assertThat(get("/api/v1/regions/resolve?lat=34.9&lng=36.25", token).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);

    // Malformed, out-of-range, and missing coordinates -> 400, never 500.
    assertThat(get("/api/v1/regions/resolve?lat=abc&lng=36.0", token).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(get("/api/v1/regions/resolve?lat=95&lng=36.0", token).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(get("/api/v1/regions/resolve?lat=33.0&lng=181", token).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(get("/api/v1/regions/resolve?lat=33.0", token).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  @DisplayName("client config serves ENABLED types of ACTIVE regions only; drafts 404")
  void shouldHideDraftAndDisabledConfig() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963934000031", RbacIds.SUPER_ADMIN_ROLE_ID);
    AuthTokensResponseDto rider = register("+963934000032", PASSWORD, "Rider");
    String token = superAdmin.accessToken();
    String regionId = createActiveRegion(token, "Gamma", 36.0, 33.0, 36.5, 33.5);

    // Add a second type and disable it (UC-A-07: disable, never delete).
    ResponseEntity<Map<String, Object>> premium =
        sendForMap(
            "/api/v1/admin/regions/" + regionId + "/service-types",
            HttpMethod.POST,
            serviceTypeBody("Premium", true),
            token);
    String premiumId = String.valueOf(premium.getBody().get("id"));
    assertThat(
            send(
                    "/api/v1/admin/service-types/" + premiumId,
                    HttpMethod.PUT,
                    serviceTypeBody("Premium", false),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);

    // The client config hides the disabled type; the admin list still shows both.
    ResponseEntity<String> config =
        get("/api/v1/regions/" + regionId + "/config", rider.accessToken());
    assertThat(config.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(config.getBody()).contains("Economy").doesNotContain("Premium");
    ResponseEntity<String> adminList =
        get("/api/v1/admin/regions/" + regionId + "/service-types", token);
    assertThat(adminList.getBody()).contains("Economy").contains("Premium");

    // Draft and unknown regions are not served.
    String draftId = createDraft(token, Map.of("name", "Draft City"));
    assertThat(get("/api/v1/regions/" + draftId + "/config", rider.accessToken()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(
            get("/api/v1/regions/" + UUID.randomUUID() + "/config", rider.accessToken())
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  @DisplayName("region boundaries may not overlap another region's (409); touching is legal")
  void shouldRejectOverlappingBoundaries() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963934000041", RbacIds.SUPER_ADMIN_ROLE_ID);
    String token = superAdmin.accessToken();
    createActiveRegion(token, "Alpha", 36.0, 33.0, 36.5, 33.5);

    // Creating with an overlapping boundary is refused outright.
    ResponseEntity<String> overlappingCreate =
        send(
            "/api/v1/admin/regions",
            HttpMethod.POST,
            fullBundle("Overlap", polygon(36.25, 33.25, 36.75, 33.75)),
            token);
    assertThat(overlappingCreate.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(overlappingCreate.getBody()).contains("overlaps");

    // A draft created without a boundary cannot take an overlapping one later…
    String draftId = createDraft(token, Map.of("name", "Delta"));
    assertThat(
            send(
                    "/api/v1/admin/regions/" + draftId,
                    HttpMethod.PUT,
                    fullBundle("Delta", polygon(36.25, 33.25, 36.75, 33.75)),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    // …a region fully inside another is an overlap too…
    assertThat(
            send(
                    "/api/v1/admin/regions/" + draftId,
                    HttpMethod.PUT,
                    fullBundle("Delta", polygon(36.1, 33.1, 36.2, 33.2)),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    // …while a merely touching (shared-edge) boundary is legal.
    assertThat(
            send(
                    "/api/v1/admin/regions/" + draftId,
                    HttpMethod.PUT,
                    fullBundle("Delta", polygon(36.5, 33.0, 37.0, 33.5)),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);
  }

  @Test
  @DisplayName("UC-A-08: zones must lie within the region's boundary; CRUD round-trips")
  void shouldEnforceZoneRulesAndCrud() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963934000051", RbacIds.SUPER_ADMIN_ROLE_ID);
    String token = superAdmin.accessToken();
    String regionId = createActiveRegion(token, "Damascus", 36.0, 33.0, 36.5, 33.5);

    // Inside the boundary -> created.
    ResponseEntity<Map<String, Object>> created =
        sendForMap(
            "/api/v1/admin/regions/" + regionId + "/surge-zones",
            HttpMethod.POST,
            zoneBody("Old City", polygon(36.1, 33.1, 36.2, 33.2)),
            token);
    assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    String zoneId = String.valueOf(created.getBody().get("id"));

    // Sticking out of the boundary -> 409.
    ResponseEntity<String> outside =
        send(
            "/api/v1/admin/regions/" + regionId + "/surge-zones",
            HttpMethod.POST,
            zoneBody("Suburb", polygon(36.4, 33.4, 36.7, 33.7)),
            token);
    assertThat(outside.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(outside.getBody()).contains("within the region's boundary");

    // Duplicate name in the region -> 409.
    assertThat(
            send(
                    "/api/v1/admin/regions/" + regionId + "/surge-zones",
                    HttpMethod.POST,
                    zoneBody("Old City", polygon(36.3, 33.3, 36.4, 33.4)),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);

    // A region without a boundary cannot take zones at all -> 409.
    String draftId = createDraft(token, Map.of("name", "Boundless"));
    assertThat(
            send(
                    "/api/v1/admin/regions/" + draftId + "/surge-zones",
                    HttpMethod.POST,
                    zoneBody("Anywhere", polygon(36.1, 33.1, 36.2, 33.2)),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);

    // Update re-checks containment; a contained edit succeeds, an escaping one is refused.
    assertThat(
            send(
                    "/api/v1/admin/surge-zones/" + zoneId,
                    HttpMethod.PUT,
                    zoneBody("Old City", polygon(36.45, 33.45, 36.6, 33.6)),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(
            send(
                    "/api/v1/admin/surge-zones/" + zoneId,
                    HttpMethod.PUT,
                    zoneBody("Citadel", polygon(36.15, 33.15, 36.25, 33.25)),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);

    // Delete, then the list is empty; a second delete 404s.
    assertThat(
            send("/api/v1/admin/surge-zones/" + zoneId, HttpMethod.DELETE, null, token)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(get("/api/v1/admin/regions/" + regionId + "/surge-zones", token).getBody())
        .isEqualTo("[]");
    assertThat(
            send("/api/v1/admin/surge-zones/" + zoneId, HttpMethod.DELETE, null, token)
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);

    // Surcharge windows: PRC-01 CRUD round-trip on the same region.
    ResponseEntity<Map<String, Object>> window =
        sendForMap(
            "/api/v1/admin/regions/" + regionId + "/surcharge-windows",
            HttpMethod.POST,
            windowBody("Morning rush", 25),
            token);
    assertThat(window.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    String windowId = String.valueOf(window.getBody().get("id"));
    ResponseEntity<String> updatedWindow =
        send(
            "/api/v1/admin/surcharge-windows/" + windowId,
            HttpMethod.PUT,
            windowBody("Evening rush", 30),
            token);
    assertThat(updatedWindow.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(updatedWindow.getBody()).contains("Evening rush");
    assertThat(
            send("/api/v1/admin/surcharge-windows/" + windowId, HttpMethod.DELETE, null, token)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(get("/api/v1/admin/regions/" + regionId + "/surcharge-windows", token).getBody())
        .isEqualTo("[]");
  }

  @Test
  @DisplayName("duplicate names are 409: region name, service-type nameEn per region")
  void shouldRejectDuplicateNames() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963934000061", RbacIds.SUPER_ADMIN_ROLE_ID);
    String token = superAdmin.accessToken();
    String regionId = createDraft(token, Map.of("name", "Damascus"));
    String otherId = createDraft(token, Map.of("name", "Aleppo"));

    // Region names are unique, case-insensitively, on create and on rename.
    assertThat(
            send("/api/v1/admin/regions", HttpMethod.POST, Map.of("name", "damascus"), token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(
            send(
                    "/api/v1/admin/regions/" + otherId,
                    HttpMethod.PUT,
                    Map.of("name", "Damascus"),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);

    // Service-type English names are unique per region; the other region may reuse them.
    assertThat(
            send(
                    "/api/v1/admin/regions/" + regionId + "/service-types",
                    HttpMethod.POST,
                    serviceTypeBody("Economy", true),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CREATED);
    assertThat(
            send(
                    "/api/v1/admin/regions/" + regionId + "/service-types",
                    HttpMethod.POST,
                    serviceTypeBody("economy", true),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(
            send(
                    "/api/v1/admin/regions/" + otherId + "/service-types",
                    HttpMethod.POST,
                    serviceTypeBody("Economy", true),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CREATED);
  }

  @Test
  @DisplayName("every region-domain mutation writes an audit entry (RBAC-05)")
  void shouldAuditEveryMutation() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963934000071", RbacIds.SUPER_ADMIN_ROLE_ID);
    String token = superAdmin.accessToken();

    String regionId = createDraft(token, fullBundle("Damascus", polygon(36.0, 33.0, 36.5, 33.5)));
    send(
        "/api/v1/admin/regions/" + regionId,
        HttpMethod.PUT,
        fullBundle("Damascus", polygon(36.0, 33.0, 36.6, 33.6)),
        token);
    ResponseEntity<Map<String, Object>> type =
        sendForMap(
            "/api/v1/admin/regions/" + regionId + "/service-types",
            HttpMethod.POST,
            serviceTypeBody("Economy", true),
            token);
    String typeId = String.valueOf(type.getBody().get("id"));
    send(
        "/api/v1/admin/service-types/" + typeId,
        HttpMethod.PUT,
        serviceTypeBody("Economy Plus", true),
        token);
    send("/api/v1/admin/regions/" + regionId + "/activate", HttpMethod.POST, null, token);
    ResponseEntity<Map<String, Object>> window =
        sendForMap(
            "/api/v1/admin/regions/" + regionId + "/surcharge-windows",
            HttpMethod.POST,
            windowBody("Rush", 25),
            token);
    String windowId = String.valueOf(window.getBody().get("id"));
    send(
        "/api/v1/admin/surcharge-windows/" + windowId,
        HttpMethod.PUT,
        windowBody("Rush", 30),
        token);
    send("/api/v1/admin/surcharge-windows/" + windowId, HttpMethod.DELETE, null, token);
    ResponseEntity<Map<String, Object>> zone =
        sendForMap(
            "/api/v1/admin/regions/" + regionId + "/surge-zones",
            HttpMethod.POST,
            zoneBody("Old City", polygon(36.1, 33.1, 36.2, 33.2)),
            token);
    String zoneId = String.valueOf(zone.getBody().get("id"));
    send(
        "/api/v1/admin/surge-zones/" + zoneId,
        HttpMethod.PUT,
        zoneBody("Citadel", polygon(36.1, 33.1, 36.2, 33.2)),
        token);
    send("/api/v1/admin/surge-zones/" + zoneId, HttpMethod.DELETE, null, token);

    ResponseEntity<String> all = get("/api/v1/admin/audit-log?size=50", token);
    assertThat(all.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(all.getBody())
        .contains("region.create")
        .contains("region.update")
        .contains("region.activate")
        .contains("service_type.create")
        .contains("service_type.update")
        .contains("surcharge_window.create")
        .contains("surcharge_window.update")
        .contains("surcharge_window.delete")
        .contains("surge_zone.create")
        .contains("surge_zone.update")
        .contains("surge_zone.delete");

    // Target filtering works for the new target types and snapshots stay compact.
    ResponseEntity<String> byTarget =
        get("/api/v1/admin/audit-log?targetType=region&targetId=" + regionId + "&size=50", token);
    assertThat(byTarget.getBody())
        .contains("region.activate")
        .contains("vertices=5")
        .doesNotContain("surge_zone.create");
  }
}
