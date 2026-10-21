package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;

/**
 * Review V1 W39 (UC-R-04 E3, suspension appeal path): the seeded "Account &amp; suspension"
 * category is listed with its {@code systemCode} so the apps pre-select it, stays protected like
 * every system category, and a rider whose rider role or whole account is suspended can still open
 * and follow support tickets.
 */
class SuspendedSupportIntegrationTest extends AbstractSupportIntegrationTest {

  private static final String ACCOUNT_SUSPEND_ID = "00000000-0000-0000-0000-000000001403";

  private JsonNode pickable(Account account) {
    return ok(get("/api/v1/support/ticket-categories", account.token()), HttpStatus.OK);
  }

  private void followsTicket(Account rider, UUID categoryId) {
    String ticketId =
        openTicket(rider, categoryId, "My rider account was suspended; please review it")
            .get("ticketId")
            .asText();
    ok(get("/api/v1/tickets/" + ticketId, rider.token()), HttpStatus.OK);
    JsonNode mine = ok(get("/api/v1/tickets", rider.token()), HttpStatus.OK);
    assertThat(mine.findValuesAsText("ticketId")).contains(ticketId);
    ok(
        post(
            "/api/v1/tickets/" + ticketId + "/messages",
            Map.of("body", "Adding details for the review"),
            rider.token()),
        HttpStatus.CREATED);
    assertThat(ticketFile(rider, "ticket_attachment")).isNotNull();
  }

  @Test
  @DisplayName("the account_suspend category is listed with its systemCode; lost_item is not")
  void shouldListTheAccountSuspendCategoryByCode() {
    Account rider = newRider();
    UUID billing = category("Billing", "normal");

    JsonNode categories = pickable(rider);
    JsonNode suspend = null;
    List<String> codes = new ArrayList<>();
    for (JsonNode category : categories) {
      codes.add(category.get("systemCode").isNull() ? null : category.get("systemCode").asText());
      if ("account_suspend".equals(category.get("systemCode").asText())) {
        suspend = category;
      }
      if (category.get("ticketCategoryId").asText().equals(billing.toString())) {
        assertThat(category.get("systemCode").isNull()).isTrue();
      }
    }
    assertThat(codes).contains("account_suspend").doesNotContain("lost_item");
    assertThat(suspend).isNotNull();
    assertThat(suspend.get("ticketCategoryId").asText()).isEqualTo(ACCOUNT_SUSPEND_ID);
    assertThat(suspend.get("name").get("en").asText()).isEqualTo("Account & suspension");
    assertThat(suspend.get("name").get("ar").asText()).isEqualTo("الحساب والإيقاف");
    assertThat(suspend.get("defaultPriority").asText()).isEqualTo("normal");
  }

  @Test
  @DisplayName("the category is a protected system row and its seed is idempotent")
  void shouldProtectTheSeededCategory() {
    JsonNode deactivated =
        restTemplate
            .exchange(
                "/api/v1/admin/ticket-categories/" + ACCOUNT_SUSPEND_ID,
                HttpMethod.PATCH,
                authorized(Map.of("active", false), admin),
                JsonNode.class)
            .getBody();
    assertThat(deactivated.get("code").asText()).isEqualTo("system_category");
    assertThat(
            delete("/api/v1/admin/ticket-categories/" + ACCOUNT_SUSPEND_ID, admin).getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);

    // Re-running the V36 seed changes nothing.
    jdbcTemplate.update(
        "INSERT INTO ticket_categories (ticket_category_id, system_code, name_en, name_ar,"
            + " default_priority, active) VALUES ('"
            + ACCOUNT_SUSPEND_ID
            + "', 'account_suspend',"
            + " 'Account & suspension', 'الحساب والإيقاف', 'normal', TRUE) ON CONFLICT DO NOTHING");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM ticket_categories WHERE system_code = 'account_suspend'"
                    + " AND active",
                Long.class))
        .isEqualTo(1L);
  }

  @Test
  @DisplayName("a rider whose rider role is suspended still opens and follows tickets")
  void shouldLetARoleSuspendedRiderUseSupport() {
    Account rider = newRider();
    jdbcTemplate.update(
        "UPDATE role_assignments SET state = 'suspended', suspension_reason = 'low_rating',"
            + " suspended_at = now() WHERE user_id = ? AND role = 'rider'",
        rider.userId());
    assertThat(pickable(rider)).isNotEmpty();
    followsTicket(rider, category("Payments", "normal"));
  }

  @Test
  @DisplayName("a rider whose whole account is suspended still opens and follows tickets")
  void shouldLetAnAccountSuspendedRiderUseSupport() {
    Account rider = newRider();
    jdbcTemplate.update(
        "UPDATE users SET state = 'suspended', suspension_reason = 'manual', suspension_note ="
            + " 'Repeated abusive messages', suspended_at = now() WHERE user_id = ?",
        rider.userId());
    // The suspension gate still holds on the feature paths...
    assertThat(get("/api/v1/wallet", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    // ...but support stays open: the appeal path.
    assertThat(pickable(rider)).isNotEmpty();
    followsTicket(rider, category("Payments", "normal"));
  }

  @Test
  @DisplayName("a role-suspended rider opens a ticket in the account_suspend category (W39)")
  void shouldLetASuspendedRiderPickTheAccountSuspendCategory() {
    Account rider = newRider();
    jdbcTemplate.update(
        "UPDATE role_assignments SET state = 'suspended', suspension_reason = 'low_rating',"
            + " suspended_at = now() WHERE user_id = ? AND role = 'rider'",
        rider.userId());
    followsTicket(rider, UUID.fromString(ACCOUNT_SUSPEND_ID));
  }
}
