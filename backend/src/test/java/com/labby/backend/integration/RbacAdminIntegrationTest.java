package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.dto.AuthTokensResponseDto;
import com.labby.backend.enums.ClientType;
import com.labby.backend.util.RbacIds;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M3-T2 acceptance: permission checks are provably server-side (403 without, 200 with), role edits
 * take effect instantly on existing sessions, admin creation follows UC-A-01 (set-password OTP path
 * and the E1 grant), the UC-A-02/03 exceptions hold, and every mutation lands in the audit log
 * (UC-A-04).
 */
class RbacAdminIntegrationTest extends AbstractAuthIntegrationTest {

  @Autowired private ObjectMapper objectMapper;

  private static final String PASSWORD = "Secret123!";

  @AfterEach
  void cleanRbacRows() {
    // Runs before the parent's cleanDatabase: clear assignment FKs, drop custom roles, and
    // restore Support's default grants (tests may edit the editable system role).
    jdbcTemplate.update("DELETE FROM role_assignments");
    jdbcTemplate.update(
        "DELETE FROM role_permissions WHERE role_id IN"
            + " (SELECT role_id FROM roles WHERE is_system = false)");
    jdbcTemplate.update("DELETE FROM roles WHERE is_system = false");
    jdbcTemplate.update("DELETE FROM role_permissions WHERE role_id = ?", RbacIds.SUPPORT_ROLE_ID);
    jdbcTemplate.update(
        "INSERT INTO role_permissions (role_id, permission_id)"
            + " SELECT ?, permission_id FROM permissions"
            + " WHERE code IN ('users:view', 'rides:view', 'regions:view', 'support:view',"
            + " 'support:handle', 'reports:view', 'reports:handle')",
        RbacIds.SUPPORT_ROLE_ID);
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

  @Test
  @DisplayName("admin endpoints: 401 anonymous, 403 without the permission, 200 with it")
  void shouldEnforcePermissionsServerSide() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963933000001", RbacIds.SUPER_ADMIN_ROLE_ID);
    AuthTokensResponseDto support = registerAdmin("+963933000002", RbacIds.SUPPORT_ROLE_ID);
    AuthTokensResponseDto rider = register("+963933000003", PASSWORD, "Plain Rider");

    assertThat(get("/api/v1/admin/admins", null).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(get("/api/v1/admin/admins", rider.accessToken()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(get("/api/v1/admin/admins", support.accessToken()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(get("/api/v1/admin/audit-log", support.accessToken()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(get("/api/v1/admin/roles", support.accessToken()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);

    assertThat(get("/api/v1/admin/admins", superAdmin.accessToken()).getStatusCode())
        .isEqualTo(HttpStatus.OK);
    assertThat(get("/api/v1/admin/audit-log", superAdmin.accessToken()).getStatusCode())
        .isEqualTo(HttpStatus.OK);
    ResponseEntity<String> roles = get("/api/v1/admin/roles", superAdmin.accessToken());
    assertThat(roles.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(roles.getBody()).contains("Super Admin").contains("Support");
    ResponseEntity<String> catalog = get("/api/v1/admin/permissions", superAdmin.accessToken());
    assertThat(catalog.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(catalog.getBody()).contains("users:view").contains("driver-review:decide");
  }

  @Test
  @DisplayName("editing a role's permissions changes a holder's access instantly, same token")
  void shouldApplyRoleEditsInstantly() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963933000011", RbacIds.SUPER_ADMIN_ROLE_ID);

    ResponseEntity<Map<String, Object>> created =
        restTemplate.exchange(
            "/api/v1/admin/roles",
            HttpMethod.POST,
            authorized(
                Map.of("name", "Auditors", "permissions", List.of("audit:view")),
                superAdmin.accessToken()),
            new ParameterizedTypeReference<>() {});
    assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    UUID roleId = UUID.fromString(String.valueOf(created.getBody().get("id")));

    AuthTokensResponseDto auditor = registerAdmin("+963933000012", roleId);
    assertThat(get("/api/v1/admin/audit-log", auditor.accessToken()).getStatusCode())
        .isEqualTo(HttpStatus.OK);
    assertThat(get("/api/v1/admin/admins", auditor.accessToken()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);

    ResponseEntity<String> updated =
        send(
            "/api/v1/admin/roles/" + roleId,
            HttpMethod.PUT,
            Map.of("name", "Auditors", "permissions", List.of("admins:view")),
            superAdmin.accessToken());
    assertThat(updated.getStatusCode()).isEqualTo(HttpStatus.OK);

    // Same access token, no re-login: permissions flipped on the very next request.
    assertThat(get("/api/v1/admin/audit-log", auditor.accessToken()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(get("/api/v1/admin/admins", auditor.accessToken()).getStatusCode())
        .isEqualTo(HttpStatus.OK);
  }

  @Test
  @DisplayName("UC-A-01: new admin via set-password OTP; E1 grant to existing; duplicate 409")
  void shouldCreateAdminsPerUseCase() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963933000021", RbacIds.SUPER_ADMIN_ROLE_ID);

    // New phone: account + set-password OTP (purpose reset), then password-reset completes it.
    String newPhone = "+963933000022";
    ResponseEntity<String> created =
        send(
            "/api/v1/admin/admins",
            HttpMethod.POST,
            Map.of("phone", newPhone, "name", "New Admin", "roleId", RbacIds.SUPPORT_ROLE_ID),
            superAdmin.accessToken());
    assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    assertThat(created.getBody()).contains("\"mode\":\"created\"");

    String code = lastCodeFor(newPhone);
    ResponseEntity<Map<String, Object>> verify =
        restTemplate.exchange(
            "/api/v1/auth/password-reset/verify",
            HttpMethod.POST,
            new HttpEntity<>(Map.of("phone", newPhone, "code", code)),
            new ParameterizedTypeReference<>() {});
    assertThat(verify.getStatusCode()).isEqualTo(HttpStatus.OK);
    String resetToken = String.valueOf(verify.getBody().get("resetToken"));
    ResponseEntity<Void> complete =
        restTemplate.postForEntity(
            "/api/v1/auth/password-reset/complete",
            Map.of("resetToken", resetToken, "newPassword", PASSWORD),
            Void.class);
    assertThat(complete.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

    AuthTokensResponseDto newAdmin = login(newPhone, PASSWORD, ClientType.ADMIN);
    assertThat(get("/api/v1/admin/admins", newAdmin.accessToken()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN); // Support holds no admins:view

    // E1: existing rider account gets the admin role granted, no OTP.
    String riderPhone = "+963933000023";
    register(riderPhone, PASSWORD, "Existing Rider");
    int smsBefore = smsCountFor(riderPhone);
    ResponseEntity<String> granted =
        send(
            "/api/v1/admin/admins",
            HttpMethod.POST,
            Map.of("phone", riderPhone, "name", "Ignored", "roleId", RbacIds.SUPPORT_ROLE_ID),
            superAdmin.accessToken());
    assertThat(granted.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    assertThat(granted.getBody()).contains("\"mode\":\"granted_existing\"");
    assertThat(smsCountFor(riderPhone)).isEqualTo(smsBefore);

    // Already an admin -> 409.
    ResponseEntity<String> duplicate =
        send(
            "/api/v1/admin/admins",
            HttpMethod.POST,
            Map.of("phone", riderPhone, "name", "X", "roleId", RbacIds.SUPPORT_ROLE_ID),
            superAdmin.accessToken());
    assertThat(duplicate.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
  }

  @Test
  @DisplayName("UC-A-03 exceptions: Super Admin immutable, system undeletable, assigned blocked")
  void shouldEnforceRoleRules() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963933000031", RbacIds.SUPER_ADMIN_ROLE_ID);
    String token = superAdmin.accessToken();

    assertThat(
            send(
                    "/api/v1/admin/roles/" + RbacIds.SUPER_ADMIN_ROLE_ID,
                    HttpMethod.PUT,
                    Map.of("name", "Super Admin", "permissions", List.of("users:view")),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(
            send(
                    "/api/v1/admin/roles/" + RbacIds.SUPPORT_ROLE_ID,
                    HttpMethod.PUT,
                    Map.of("name", "Helpdesk", "permissions", List.of("users:view")),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(
            send("/api/v1/admin/roles/" + RbacIds.SUPPORT_ROLE_ID, HttpMethod.DELETE, null, token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);

    // Support's permission SET is editable (RBAC-04).
    ResponseEntity<String> supportEdit =
        send(
            "/api/v1/admin/roles/" + RbacIds.SUPPORT_ROLE_ID,
            HttpMethod.PUT,
            Map.of("name", "Support", "permissions", List.of("users:view", "audit:view")),
            token);
    assertThat(supportEdit.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(supportEdit.getBody()).contains("audit:view");

    // Custom role: deletion blocked while assigned, allowed after reassignment.
    ResponseEntity<Map<String, Object>> created =
        restTemplate.exchange(
            "/api/v1/admin/roles",
            HttpMethod.POST,
            authorized(Map.of("name", "Temp", "permissions", List.of("rides:view")), token),
            new ParameterizedTypeReference<>() {});
    UUID tempRoleId = UUID.fromString(String.valueOf(created.getBody().get("id")));
    AuthTokensResponseDto holder = registerAdmin("+963933000032", tempRoleId);
    assertThat(
            send("/api/v1/admin/roles/" + tempRoleId, HttpMethod.DELETE, null, token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(
            send(
                    "/api/v1/admin/admins/" + holder.user().id() + "/role",
                    HttpMethod.PUT,
                    Map.of("roleId", RbacIds.SUPPORT_ROLE_ID),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);
    assertThat(
            send("/api/v1/admin/roles/" + tempRoleId, HttpMethod.DELETE, null, token)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
  }

  @Test
  @DisplayName("malformed UUID path/query params are 400 per the contract, never 500")
  void shouldRejectMalformedUuidParams() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963933000071", RbacIds.SUPER_ADMIN_ROLE_ID);
    String token = superAdmin.accessToken();

    assertThat(
            send("/api/v1/admin/admins/not-a-uuid/deactivate", HttpMethod.POST, null, token)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            send(
                    "/api/v1/admin/roles/not-a-uuid",
                    HttpMethod.PUT,
                    Map.of("name", "X", "permissions", List.of("users:view")),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(get("/api/v1/admin/audit-log?actorId=not-a-uuid", token).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  @DisplayName("escalation guards: Super Admin grants need a Super Admin actor; no own-role edits")
  void shouldBlockPermissionSelfEscalation() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963933000081", RbacIds.SUPER_ADMIN_ROLE_ID);
    String saToken = superAdmin.accessToken();

    ResponseEntity<Map<String, Object>> managers =
        restTemplate.exchange(
            "/api/v1/admin/roles",
            HttpMethod.POST,
            authorized(
                Map.of(
                    "name",
                    "Managers",
                    "permissions",
                    List.of("admins:manage", "admins:view", "roles:manage", "roles:view")),
                saToken),
            new ParameterizedTypeReference<>() {});
    UUID managersId = UUID.fromString(String.valueOf(managers.getBody().get("id")));
    AuthTokensResponseDto manager = registerAdmin("+963933000082", managersId);
    String mToken = manager.accessToken();

    // admins:manage alone cannot mint a Super Admin — neither fresh nor by role change.
    assertThat(
            send(
                    "/api/v1/admin/admins",
                    HttpMethod.POST,
                    Map.of(
                        "phone",
                        "+963933000083",
                        "name",
                        "Mallory",
                        "roleId",
                        RbacIds.SUPER_ADMIN_ROLE_ID),
                    mToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(
            send(
                    "/api/v1/admin/admins/" + manager.user().id() + "/role",
                    HttpMethod.PUT,
                    Map.of("roleId", RbacIds.SUPER_ADMIN_ROLE_ID),
                    mToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);

    // roles:manage alone cannot widen the actor's own role…
    assertThat(
            send(
                    "/api/v1/admin/roles/" + managersId,
                    HttpMethod.PUT,
                    Map.of("name", "Managers", "permissions", List.of("admins:manage")),
                    mToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);

    // …but other roles stay editable, and a real Super Admin can still grant the role.
    ResponseEntity<Map<String, Object>> clerks =
        restTemplate.exchange(
            "/api/v1/admin/roles",
            HttpMethod.POST,
            authorized(Map.of("name", "Clerks", "permissions", List.of("rides:view")), saToken),
            new ParameterizedTypeReference<>() {});
    UUID clerksId = UUID.fromString(String.valueOf(clerks.getBody().get("id")));
    assertThat(
            send(
                    "/api/v1/admin/roles/" + clerksId,
                    HttpMethod.PUT,
                    Map.of("name", "Clerks", "permissions", List.of("rides:view", "users:view")),
                    mToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);
    assertThat(
            send(
                    "/api/v1/admin/admins/" + manager.user().id() + "/role",
                    HttpMethod.PUT,
                    Map.of("roleId", RbacIds.SUPER_ADMIN_ROLE_ID),
                    saToken)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);
  }

  @Test
  @DisplayName("UC-A-02 E1: the last active Super Admin is protected; a second one unblocks")
  void shouldProtectLastSuperAdmin() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963933000041", RbacIds.SUPER_ADMIN_ROLE_ID);
    String token = superAdmin.accessToken();
    UUID selfId = superAdmin.user().id();

    assertThat(
            send("/api/v1/admin/admins/" + selfId + "/deactivate", HttpMethod.POST, null, token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(
            send(
                    "/api/v1/admin/admins/" + selfId + "/role",
                    HttpMethod.PUT,
                    Map.of("roleId", RbacIds.SUPPORT_ROLE_ID),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);

    AuthTokensResponseDto second = registerAdmin("+963933000042", RbacIds.SUPER_ADMIN_ROLE_ID);
    assertThat(
            send(
                    "/api/v1/admin/admins/" + second.user().id() + "/deactivate",
                    HttpMethod.POST,
                    null,
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);
    // The deactivated Super Admin no longer counts as active: the first is last again.
    assertThat(
            send("/api/v1/admin/admins/" + selfId + "/deactivate", HttpMethod.POST, null, token)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(
            send(
                    "/api/v1/admin/admins/" + second.user().id() + "/reactivate",
                    HttpMethod.POST,
                    null,
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);
  }

  @Test
  @DisplayName(
      "W5/I31: a deactivated admin signs in and reads the note and date; reactivation clears")
  void shouldShowTheDeactivationOnTheProfile() throws Exception {
    AuthTokensResponseDto superAdmin = registerAdmin("+963933000071", RbacIds.SUPER_ADMIN_ROLE_ID);
    AuthTokensResponseDto support = registerAdmin("+963933000072", RbacIds.SUPPORT_ROLE_ID);
    UUID supportId = support.user().id();
    assertThat(
            send(
                    "/api/v1/admin/admins/" + supportId + "/deactivate",
                    HttpMethod.POST,
                    Map.of("note", "Support contract ended on 15 Oct."),
                    superAdmin.accessToken())
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);

    // The deactivated admin still signs in to the admin client and reads why and since when.
    AuthTokensResponseDto again = login("+963933000072", PASSWORD, ClientType.ADMIN);
    JsonNode me = objectMapper.readTree(get("/api/v1/users/me", again.accessToken()).getBody());
    JsonNode admin = assignment(me, "admin");
    assertThat(admin.get("state").asText()).isEqualTo("suspended");
    assertThat(admin.get("suspensionReason").asText()).isEqualTo("manual");
    assertThat(admin.get("suspensionNote").asText()).isEqualTo("Support contract ended on 15 Oct.");
    assertThat(admin.get("suspendedAt").asText()).isNotBlank();
    assertThat(assignment(me, "rider").has("suspendedAt")).isFalse(); // other roles untouched
    assertThat(me.get("state").asText()).isEqualTo("active");
    assertThat(me.get("suspendedAt").isNull()).isTrue();

    // Reactivated, then deactivated without a note: the date only.
    send(
        "/api/v1/admin/admins/" + supportId + "/reactivate",
        HttpMethod.POST,
        null,
        superAdmin.accessToken());
    JsonNode active =
        assignment(
            objectMapper.readTree(get("/api/v1/users/me", again.accessToken()).getBody()), "admin");
    assertThat(active.get("state").asText()).isEqualTo("active");
    assertThat(active.has("suspensionNote")).isFalse();
    assertThat(active.has("suspendedAt")).isFalse();
    send(
        "/api/v1/admin/admins/" + supportId + "/deactivate",
        HttpMethod.POST,
        null,
        superAdmin.accessToken());
    JsonNode bare =
        assignment(
            objectMapper.readTree(get("/api/v1/users/me", again.accessToken()).getBody()), "admin");
    assertThat(bare.get("state").asText()).isEqualTo("suspended");
    assertThat(bare.has("suspensionNote")).isFalse();
    assertThat(bare.get("suspendedAt").asText()).isNotBlank();

    // A whole-account suspension (USR-06) carries its note and date on the profile itself.
    jdbcTemplate.update(
        "UPDATE users SET state = 'suspended', suspension_reason = 'manual',"
            + " suspension_note = 'Repeated abuse', suspended_at = now() WHERE user_id = ?",
        supportId);
    JsonNode suspended =
        objectMapper.readTree(get("/api/v1/users/me", again.accessToken()).getBody());
    assertThat(suspended.get("state").asText()).isEqualTo("suspended");
    assertThat(suspended.get("suspensionNote").asText()).isEqualTo("Repeated abuse");
    assertThat(suspended.get("suspendedAt").asText()).isNotBlank();
  }

  private static JsonNode assignment(JsonNode profile, String role) {
    for (JsonNode assignment : profile.get("roles")) {
      if (role.equals(assignment.get("role").asText())) {
        return assignment;
      }
    }
    throw new AssertionError("No " + role + " assignment");
  }

  @Test
  @DisplayName("/users/me exposes the admin's own RBAC role and permissions for UI gating")
  void shouldExposeOwnPermissionsOnProfile() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963933000061", RbacIds.SUPER_ADMIN_ROLE_ID);

    ResponseEntity<Map<String, Object>> created =
        restTemplate.exchange(
            "/api/v1/admin/roles",
            HttpMethod.POST,
            authorized(
                Map.of("name", "Gated", "permissions", List.of("audit:view")),
                superAdmin.accessToken()),
            new ParameterizedTypeReference<>() {});
    UUID roleId = UUID.fromString(String.valueOf(created.getBody().get("id")));
    AuthTokensResponseDto gated = registerAdmin("+963933000062", roleId);

    // The login response already carries the enrichment…
    ResponseEntity<String> me = get("/api/v1/users/me", gated.accessToken());
    assertThat(me.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(me.getBody()).contains("\"rbacRole\"").contains("\"Gated\"").contains("audit:view");
    // …and the rider assignment stays bare (fields absent, not null).
    assertThat(me.getBody()).doesNotContain("\"rbacRole\":null");

    // After a role edit, the next profile fetch reflects the new set (UI refresh semantics).
    send(
        "/api/v1/admin/roles/" + roleId,
        HttpMethod.PUT,
        Map.of("name", "Gated", "permissions", List.of("admins:view")),
        superAdmin.accessToken());
    ResponseEntity<String> refreshed = get("/api/v1/users/me", gated.accessToken());
    assertThat(refreshed.getBody()).contains("admins:view").doesNotContain("audit:view");
  }

  @Test
  @SuppressWarnings("unchecked")
  @DisplayName("every mutating admin action writes an audit entry; filters work (UC-A-04)")
  void shouldAuditEveryMutation() {
    AuthTokensResponseDto superAdmin = registerAdmin("+963933000051", RbacIds.SUPER_ADMIN_ROLE_ID);
    String token = superAdmin.accessToken();

    ResponseEntity<Map<String, Object>> created =
        restTemplate.exchange(
            "/api/v1/admin/roles",
            HttpMethod.POST,
            authorized(Map.of("name", "Audited", "permissions", List.of("rides:view")), token),
            new ParameterizedTypeReference<>() {});
    UUID roleId = UUID.fromString(String.valueOf(created.getBody().get("id")));
    send(
        "/api/v1/admin/roles/" + roleId,
        HttpMethod.PUT,
        Map.of("name", "Audited", "permissions", List.of("rides:view", "users:view")),
        token);
    String adminPhone = "+963933000052";
    register(adminPhone, PASSWORD, "Audit Target");
    ResponseEntity<Map<String, Object>> grant =
        restTemplate.exchange(
            "/api/v1/admin/admins",
            HttpMethod.POST,
            authorized(Map.of("phone", adminPhone, "name", "Ignored", "roleId", roleId), token),
            new ParameterizedTypeReference<>() {});
    assertThat(grant.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    Map<String, Object> admin = (Map<String, Object>) grant.getBody().get("admin");
    String targetId = String.valueOf(admin.get("id"));
    send(
        "/api/v1/admin/admins/" + targetId + "/role",
        HttpMethod.PUT,
        Map.of("roleId", RbacIds.SUPPORT_ROLE_ID),
        token);
    send("/api/v1/admin/admins/" + targetId + "/deactivate", HttpMethod.POST, null, token);
    send("/api/v1/admin/admins/" + targetId + "/reactivate", HttpMethod.POST, null, token);
    send("/api/v1/admin/roles/" + roleId, HttpMethod.DELETE, null, token);

    ResponseEntity<String> all = get("/api/v1/admin/audit-log?size=50", token);
    assertThat(all.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(all.getBody())
        .contains("role.create")
        .contains("role.update")
        .contains("role.delete")
        .contains("admin.create")
        .contains("admin.role_change")
        .contains("admin.deactivate")
        .contains("admin.reactivate");

    ResponseEntity<String> filtered =
        get("/api/v1/admin/audit-log?action=role.update&size=50", token);
    assertThat(filtered.getBody()).contains("role.update").doesNotContain("admin.deactivate");
    ResponseEntity<String> byActor =
        get("/api/v1/admin/audit-log?actorId=" + superAdmin.user().id() + "&size=50", token);
    assertThat(byActor.getBody()).contains("admin.create");
    ResponseEntity<String> byTarget =
        get("/api/v1/admin/audit-log?targetType=admin&targetId=" + targetId + "&size=50", token);
    assertThat(byTarget.getBody()).contains("admin.role_change").doesNotContain("role.create");
  }
}
