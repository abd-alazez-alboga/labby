package com.labby.backend.service;

import java.util.List;
import java.util.UUID;

/** Resolves a user's admin permission authorities for the security layer (RBAC-02/03). */
public interface PermissionService {

  /**
   * Returns the {@code domain:action} codes granted by the user's ACTIVE admin role assignment,
   * read fresh from the DB so role edits, role changes, and deactivation apply to the very next
   * request — never baked into tokens.
   *
   * @param userId the account id
   * @return the permission codes; empty when the user holds no active admin role
   */
  List<String> permissionCodesFor(UUID userId);
}
