package com.labby.backend.unit.enums;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.labby.backend.enums.Permission;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Catalog invariants: the enum is the contract shared verbatim with the frontend (RBAC-02). */
class PermissionTest {

  @Test
  @DisplayName("every code is a well-formed domain:action string")
  void shouldMatchDomainActionShapeForEveryCode() {
    for (Permission permission : Permission.values()) {
      assertThat(permission.getValue()).matches("^[a-z][a-z-]*:[a-z][a-z-]*$");
    }
  }

  @Test
  @DisplayName("codes are unique")
  void shouldHaveUniqueCodes() {
    List<String> codes = Arrays.stream(Permission.values()).map(Permission::getValue).toList();

    assertThat(codes).doesNotHaveDuplicates();
  }

  @Test
  @DisplayName("the catalog covers exactly the M3-T1 domains plus M8's wallets")
  void shouldCoverExpectedDomains() {
    Set<String> domains =
        Arrays.stream(Permission.values()).map(Permission::getDomain).collect(Collectors.toSet());

    assertThat(domains)
        .containsExactlyInAnyOrder(
            "users",
            "rides",
            "regions",
            "pricing",
            "driver-review",
            "support",
            "settlements",
            "promos",
            "analytics",
            "audit",
            "admins",
            "roles",
            "wallets",
            "reports");
  }

  @Test
  @DisplayName("getDomain returns the prefix of the code")
  void shouldDeriveDomainFromCodePrefix() {
    assertThat(Permission.USERS_VIEW.getDomain()).isEqualTo("users");
    assertThat(Permission.DRIVER_REVIEW_DECIDE.getDomain()).isEqualTo("driver-review");
  }

  @Test
  @DisplayName("fromValue round-trips every constant and rejects unknowns")
  void shouldRoundTripFromValueAndRejectUnknown() {
    for (Permission permission : Permission.values()) {
      assertThat(Permission.fromValue(permission.getValue())).isEqualTo(permission);
    }
    assertThatThrownBy(() -> Permission.fromValue("nope:nope"))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
