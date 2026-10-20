package com.labby.backend.service;

import com.labby.backend.dto.AdminAccountDto;
import com.labby.backend.dto.ChangeAdminRoleRequestDto;
import com.labby.backend.dto.CreateAdminRequestDto;
import com.labby.backend.dto.CreateAdminResponseDto;
import java.util.List;
import java.util.UUID;

/** Admin account management by the Super Admin (UC-A-01/02, AUTH-06, RBAC-01). */
public interface AdminAccountService {

  /** Lists all admin accounts (any assignment state). */
  List<AdminAccountDto> listAdmins();

  /**
   * Creates an admin with exactly one role. New phone: a fresh account with an unusable password
   * plus a set-password OTP (purpose {@code reset}) sent to the phone (AUTH-06). Existing phone:
   * the account is granted the admin role instead (UC-A-01 E1, no OTP).
   *
   * @param actorUserId the acting Super Admin (audited)
   * @param request phone, name, roleId
   * @return the outcome mode and the admin account
   */
  CreateAdminResponseDto createAdmin(UUID actorUserId, CreateAdminRequestDto request);

  /**
   * Replaces an admin's single role, effective on the next request (RBAC-02).
   *
   * @param actorUserId the acting admin (audited)
   * @param userId the target admin's user id
   * @param request the new role
   * @return the updated admin account
   */
  AdminAccountDto changeRole(UUID actorUserId, UUID userId, ChangeAdminRoleRequestDto request);

  /**
   * Suspends the admin role assignment; other roles of the account are untouched. The last active
   * Super Admin cannot be deactivated (UC-A-02 E1).
   *
   * @param actorUserId the acting admin (audited)
   * @param userId the target admin's user id
   * @return the updated admin account
   */
  AdminAccountDto deactivate(UUID actorUserId, UUID userId);

  /**
   * Reactivates a deactivated admin.
   *
   * @param actorUserId the acting admin (audited)
   * @param userId the target admin's user id
   * @return the updated admin account
   */
  AdminAccountDto reactivate(UUID actorUserId, UUID userId);

  /**
   * {@link #deactivate(UUID, UUID)}, and the admin is notified (account category, EN + AR) with the
   * optional note when their admin role actually changed state (V1 audit W10, USR-04).
   *
   * @param actorUserId the acting admin (audited)
   * @param userId the target admin's user id
   * @param note the reason shown to the admin, or null
   * @return the updated admin account
   */
  AdminAccountDto deactivate(UUID actorUserId, UUID userId, String note);

  /**
   * {@link #reactivate(UUID, UUID)}, and the admin is notified with the optional note when their
   * admin role actually changed state (V1 audit W10, USR-04).
   *
   * @param actorUserId the acting admin (audited)
   * @param userId the target admin's user id
   * @param note the reason shown to the admin, or null
   * @return the updated admin account
   */
  AdminAccountDto reactivate(UUID actorUserId, UUID userId, String note);
}
