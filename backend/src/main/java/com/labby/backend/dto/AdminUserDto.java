package com.labby.backend.dto;

import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A users-list row (analytics-v1 {@code AdminUser}). {@code phone} is contact access (UC-A-20):
 * null unless the caller holds {@code support:handle}.
 */
public record AdminUserDto(
    UUID userId,
    String name,
    String phone,
    AccountState state,
    List<RoleDto> roles,
    Instant createdAt) {

  /** One role the account holds. */
  public record RoleDto(Role role, RoleState state) {}

  /**
   * This row without the phone (no contact access).
   *
   * @return the copy
   */
  public AdminUserDto withoutPhone() {
    return new AdminUserDto(userId, name, null, state, roles, createdAt);
  }
}
