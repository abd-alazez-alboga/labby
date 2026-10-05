package com.labby.backend.service;

import com.labby.backend.dto.UserProfileDto;
import com.labby.backend.model.RoleAssignment;
import com.labby.backend.model.User;
import java.util.List;

/** Assembles the API profile, enriching the admin assignment with its RBAC data (RBAC-03). */
public interface ProfileService {

  /**
   * Builds the profile DTO. On the admin role assignment, {@code rbacRole} and {@code permissions}
   * carry the single RBAC role and its codes so the admin UI can gate routes/menus; other
   * assignments are returned bare.
   *
   * @param user the account
   * @param roles the account's role assignments
   * @return the profile DTO
   */
  UserProfileDto profileFor(User user, List<RoleAssignment> roles);
}
