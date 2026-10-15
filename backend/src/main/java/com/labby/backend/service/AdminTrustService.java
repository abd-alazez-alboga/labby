package com.labby.backend.service;

import com.labby.backend.dto.AdminUserTrustDto;
import com.labby.backend.enums.RideParty;
import java.util.UUID;

/**
 * The trust sections of the admin user profile (UC-A-13/14): role states with reasons, LIVE
 * averages (admins only), open flags, active metric warnings and report history — plus the suspend
 * / reactivate actions answering with the updated profile.
 */
public interface AdminTrustService {

  /**
   * The user's trust profile.
   *
   * @param userId the user
   * @return the profile
   * @throws com.labby.backend.exception.ResourceNotFoundException unknown user
   */
  AdminUserTrustDto trust(UUID userId);

  /**
   * Suspends one role (see {@link SuspensionService#suspendRole}).
   *
   * @param actorUserId the admin
   * @param userId the user
   * @param role the role
   * @param note the reason
   * @return the updated profile
   */
  AdminUserTrustDto suspendRole(UUID actorUserId, UUID userId, RideParty role, String note);

  /**
   * Reactivates one role (see {@link SuspensionService#reactivateRole}).
   *
   * @param actorUserId the admin
   * @param userId the user
   * @param role the role
   * @param note the reason
   * @return the updated profile
   */
  AdminUserTrustDto reactivateRole(UUID actorUserId, UUID userId, RideParty role, String note);

  /**
   * Suspends the whole account (see {@link SuspensionService#suspendAccount}).
   *
   * @param actorUserId the admin
   * @param userId the user
   * @param note the reason
   * @return the updated profile
   */
  AdminUserTrustDto suspendAccount(UUID actorUserId, UUID userId, String note);

  /**
   * Reactivates the whole account (see {@link SuspensionService#reactivateAccount}).
   *
   * @param actorUserId the admin
   * @param userId the user
   * @param note the reason
   * @return the updated profile
   */
  AdminUserTrustDto reactivateAccount(UUID actorUserId, UUID userId, String note);
}
