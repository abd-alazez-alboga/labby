package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * UC-A-15/27: grants/refunds and settlements are permission-gated ({@code wallets:*}, {@code
 * settlements:*}), validated (refunds ride-linked, PAY-03), audited and notify the user.
 */
class AdminMoneyIntegrationTest extends AbstractMoneyIntegrationTest {

  private Map<String, Object> credit(String type, String amount, UUID rideId) {
    Map<String, Object> body = new HashMap<>();
    body.put("type", type);
    body.put("amount", amount);
    body.put("currency", "SYP");
    body.put("reason", "owner goodwill");
    if (rideId != null) {
      body.put("rideId", rideId.toString());
    }
    return body;
  }

  @Test
  @DisplayName("UC-A-15: a grant credits instantly, notifies the user and is audited")
  void shouldGrantCredit() {
    Account rider = rider();
    JsonNode granted =
        ok(
            post(
                "/api/v1/admin/users/" + rider.userId() + "/wallet/credits",
                credit("grant", "7.25", null),
                admin),
            HttpStatus.CREATED);
    assertThat(granted.get("type").asText()).isEqualTo("admin_grant");
    assertThat(granted.get("amount").decimalValue()).isEqualByComparingTo("7.25");
    assertThat(granted.get("balanceAfter").decimalValue()).isEqualByComparingTo("7.25");
    assertThat(granted.get("reason").asText()).isEqualTo("owner goodwill");
    assertThat(walletBalance(rider.userId())).isEqualByComparingTo("7.25");
    assertThat(outboxEvents(rider.userId())).contains("wallet.granted");
    assertThat(auditActions(rider.userId().toString())).contains("wallet.grant");

    // The admin views mirror the rider's wallet.
    JsonNode wallet =
        ok(get("/api/v1/admin/users/" + rider.userId() + "/wallet", admin), HttpStatus.OK);
    assertThat(wallet.get("balances").get(0).get("balance").decimalValue())
        .isEqualByComparingTo("7.25");
    JsonNode transactions =
        ok(
            get("/api/v1/admin/users/" + rider.userId() + "/wallet/transactions", admin),
            HttpStatus.OK);
    assertThat(transactions.get("totalItems").asLong()).isEqualTo(1);
    JsonNode own = ok(get("/api/v1/wallet", rider.token()), HttpStatus.OK);
    assertThat(own.get("balances").get(0).get("balance").decimalValue())
        .isEqualByComparingTo("7.25");
  }

  @Test
  @DisplayName("PAY-03: a refund must link a ride of that user; valid refunds are audited")
  void shouldValidateRefundLinks() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = completeRide(rider, driver, "cash");
    ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);

    String url = "/api/v1/admin/users/" + rider.userId() + "/wallet/credits";
    // No ride link, or another user's ride → 400.
    assertThat(post(url, credit("refund", "1.00", null), admin).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    Account stranger = rider();
    assertThat(
            post(
                    "/api/v1/admin/users/" + stranger.userId() + "/wallet/credits",
                    credit("refund", "1.00", rideId),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    JsonNode refunded = ok(post(url, credit("refund", "1.50", rideId), admin), HttpStatus.CREATED);
    assertThat(refunded.get("type").asText()).isEqualTo("refund");
    assertThat(refunded.get("rideId").asText()).isEqualTo(rideId.toString());
    assertThat(outboxEvents(rider.userId())).contains("wallet.refunded");
    assertThat(auditActions(rider.userId().toString())).contains("wallet.refund");
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("RBAC-03: wallet and settlement endpoints are permission-gated server-side")
  void shouldGateMoneyEndpoints() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    // An admin WITHOUT the money permissions (empty custom role).
    UUID roleId =
        jdbcTemplate.queryForObject(
            "INSERT INTO roles (name, is_system) VALUES ('Money-less', false) RETURNING role_id",
            UUID.class);
    String powerless = registerAdmin("+963937815001", roleId);

    assertThat(get("/api/v1/admin/users/" + rider.userId() + "/wallet", powerless).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            post(
                    "/api/v1/admin/users/" + rider.userId() + "/wallet/credits",
                    credit("grant", "1.00", null),
                    powerless)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            get("/api/v1/admin/drivers/" + driver.userId() + "/ledger", powerless).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            post(
                    "/api/v1/admin/drivers/" + driver.userId() + "/settlements",
                    Map.of("amount", "1.00", "direction", "pay_in", "currency", "SYP"),
                    powerless)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    // A rider token is no admin at all.
    assertThat(
            get("/api/v1/admin/users/" + rider.userId() + "/wallet", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    // Nothing moved, nothing audited.
    assertThat(walletBalance(rider.userId())).isEqualByComparingTo("0");
    assertThat(auditActions(rider.userId().toString())).isEmpty();
  }

  @Test
  @DisplayName("UC-A-27: the ledger view pages typed entries; settlements are recorded and audited")
  void shouldRecordSettlementsAndServeLedger() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = completeRide(rider, driver, "cash");
    ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);
    advance(java.time.Duration.ofSeconds(5)); // newest-first ordering needs a later timestamp

    JsonNode settled =
        ok(
            post(
                "/api/v1/admin/drivers/" + driver.userId() + "/settlements",
                Map.of(
                    "amount", "0.38",
                    "direction", "pay_in",
                    "currency", "SYP",
                    "note", "cash desk"),
                admin),
            HttpStatus.CREATED);
    assertThat(settled.get("balance").decimalValue()).isEqualByComparingTo("0.00");
    assertThat(settled.get("floorStatus").asText()).isEqualTo("ok");
    assertThat(settled.get("note").asText()).isEqualTo("cash desk");
    assertThat(auditActions(settled.get("id").asText())).contains("settlement.record");

    JsonNode ledger =
        ok(get("/api/v1/admin/drivers/" + driver.userId() + "/ledger", admin), HttpStatus.OK);
    assertThat(ledger.get("totalItems").asLong()).isEqualTo(2); // commission_due + pay_in
    assertThat(ledger.get("entries").get(0).get("type").asText()).isEqualTo("settlement_pay_in");
    assertThat(ledger.get("entries").get(0).get("settlementId").asText())
        .isEqualTo(settled.get("id").asText());
    assertThat(ledger.get("balances").get(0).get("balance").decimalValue())
        .isEqualByComparingTo("0.00");

    // Unknowns are 404s: a non-driver ledger / settlement, an unknown wallet user.
    assertThat(get("/api/v1/admin/drivers/" + rider.userId() + "/ledger", admin).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    ResponseEntity<JsonNode> notDriver =
        post(
            "/api/v1/admin/drivers/" + rider.userId() + "/settlements",
            Map.of("amount", "1.00", "direction", "pay_in", "currency", "SYP"),
            admin);
    assertThat(notDriver.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(get("/api/v1/admin/users/" + UUID.randomUUID() + "/wallet", admin).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("RBAC-03: wallets:view alone reads a wallet (200) but cannot credit it (403)")
  void shouldSplitWalletViewFromManage() {
    Account rider = rider();
    UUID roleId =
        jdbcTemplate.queryForObject(
            "INSERT INTO roles (name, is_system) VALUES ('Wallet viewer', false) RETURNING role_id",
            UUID.class);
    jdbcTemplate.update(
        "INSERT INTO role_permissions (role_id, permission_id)"
            + " SELECT ?, permission_id FROM permissions WHERE code = 'wallets:view'",
        roleId);
    String viewer = registerAdmin("+963937815002", roleId);

    ok(get("/api/v1/admin/users/" + rider.userId() + "/wallet", viewer), HttpStatus.OK);
    ok(
        get("/api/v1/admin/users/" + rider.userId() + "/wallet/transactions", viewer),
        HttpStatus.OK);
    assertThat(
            post(
                    "/api/v1/admin/users/" + rider.userId() + "/wallet/credits",
                    credit("grant", "1.00", null),
                    viewer)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(walletBalance(rider.userId())).isEqualByComparingTo("0");
  }

  @Test
  @DisplayName(
      "W7: credits need a currency some region uses; a refund is in its ride's currency;"
          + " settlements in a held or operating-region currency — else 400")
  void shouldValidateCurrencies() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = completeRide(rider, driver, "cash");
    ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);
    String creditsUrl = "/api/v1/admin/users/" + rider.userId() + "/wallet/credits";

    // No region uses XYZ → 400, nothing credited.
    Map<String, Object> unknown = credit("grant", "1.00", null);
    unknown.put("currency", "XYZ");
    ResponseEntity<JsonNode> refused = post(creditsUrl, unknown, admin);
    assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(refused.getBody().get("message").asText()).contains("currency");

    // A (draft) USD region makes USD a usable grant currency …
    jdbcTemplate.update("INSERT INTO regions (name, currency) VALUES ('Dollar Draft', 'USD')");
    Map<String, Object> usdGrant = credit("grant", "1.00", null);
    usdGrant.put("currency", "USD");
    ok(post(creditsUrl, usdGrant, admin), HttpStatus.CREATED);
    // … but a refund of the SYP ride must be in SYP.
    Map<String, Object> usdRefund = credit("refund", "1.00", rideId);
    usdRefund.put("currency", "USD");
    assertThat(post(creditsUrl, usdRefund, admin).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    ok(post(creditsUrl, credit("refund", "1.00", rideId), admin), HttpStatus.CREATED);

    // Settlements: SYP is held (and the operating region's); USD is neither → 400.
    String settlementsUrl = "/api/v1/admin/drivers/" + driver.userId() + "/settlements";
    assertThat(
            post(
                    settlementsUrl,
                    Map.of("amount", "1.00", "direction", "pay_in", "currency", "USD"),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    ok(
        post(
            settlementsUrl,
            Map.of("amount", "0.38", "direction", "pay_in", "currency", "SYP"),
            admin),
        HttpStatus.CREATED);
    // A driver with no balance yet may settle in the operating region's currency.
    Account fresh = driverAt(PICKUP_LAT, PICKUP_LNG);
    ok(
        post(
            "/api/v1/admin/drivers/" + fresh.userId() + "/settlements",
            Map.of("amount", "5.00", "direction", "pay_in", "currency", "SYP"),
            admin),
        HttpStatus.CREATED);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM settlements WHERE currency = 'USD'", Integer.class))
        .isZero();
    assertLedgerInvariants();
  }
}
