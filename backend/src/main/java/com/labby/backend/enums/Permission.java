package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Admin permission catalog (RBAC-02/03). The code-side source of truth: V4 seeds catalog v1 and
 * {@code RbacCatalogSeeder} syncs later additions into the {@code permissions} table at boot.
 * Values are the {@code domain:action} authority strings shared VERBATIM with the admin frontend
 * and used in {@code @PreAuthorize} checks from M3-T2 on. Entries are never removed here without a
 * migration removing the row (and its grants) first.
 */
public enum Permission {
  USERS_VIEW("users:view"),
  USERS_SUSPEND("users:suspend"),
  RIDES_VIEW("rides:view"),
  REGIONS_VIEW("regions:view"),
  REGIONS_EDIT("regions:edit"),
  PRICING_VIEW("pricing:view"),
  PRICING_EDIT("pricing:edit"),
  DRIVER_REVIEW_VIEW("driver-review:view"),
  DRIVER_REVIEW_DECIDE("driver-review:decide"),
  SUPPORT_VIEW("support:view"),
  SUPPORT_HANDLE("support:handle"),
  SETTLEMENTS_VIEW("settlements:view"),
  SETTLEMENTS_RECORD("settlements:record"),
  WALLETS_VIEW("wallets:view"),
  WALLETS_MANAGE("wallets:manage"),
  PROMOS_VIEW("promos:view"),
  PROMOS_MANAGE("promos:manage"),
  ANALYTICS_VIEW("analytics:view"),
  ANALYTICS_EXPORT("analytics:export"),
  AUDIT_VIEW("audit:view"),
  ADMINS_VIEW("admins:view"),
  ADMINS_MANAGE("admins:manage"),
  ROLES_VIEW("roles:view"),
  ROLES_MANAGE("roles:manage");

  private final String value;

  Permission(String value) {
    this.value = value;
  }

  @JsonValue
  public String getValue() {
    return value;
  }

  /** The domain part of the {@code domain:action} code (groups the role-builder checklist). */
  public String getDomain() {
    return value.substring(0, value.indexOf(':'));
  }

  /**
   * Resolves an enum constant from its wire/db code.
   *
   * @param value the wire value
   * @return the matching constant
   */
  @JsonCreator
  public static Permission fromValue(String value) {
    for (Permission candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown Permission value: " + value);
  }
}
