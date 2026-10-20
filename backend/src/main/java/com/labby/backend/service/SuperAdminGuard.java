package com.labby.backend.service;

import com.labby.backend.exception.ConflictException;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.util.RbacIds;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The last-active-Super-Admin protection (RBAC-01, UC-A-02 E1, M3 MC-2), shared by every path that
 * can take an account's Super Admin access away — demotion and deactivation (admin management) and
 * the account's own deletion (UC-S-07). Review V1 W9: the Super Admin assignments are locked FOR
 * UPDATE before counting, so concurrent removals run one after the other and the later one counts
 * what the earlier committed; only assignments of ACTIVE accounts count.
 */
@Component
@RequiredArgsConstructor
public class SuperAdminGuard {

  /** The machine code of the refusal (409). */
  public static final String LAST_SUPER_ADMIN = "last_super_admin";

  private final RoleAssignmentRepository roleAssignmentRepository;

  /**
   * Refuses when the account is the last active Super Admin. Runs inside the caller's transaction:
   * the lock lasts until it ends.
   *
   * @param userId the account about to lose Super Admin access
   * @param message the refusal message
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void requireNotLast(UUID userId, String message) {
    roleAssignmentRepository.lockAdminAssignments(RbacIds.SUPER_ADMIN_ROLE_ID);
    if (roleAssignmentRepository.isActiveHolder(userId, RbacIds.SUPER_ADMIN_ROLE_ID)
        && roleAssignmentRepository.countActiveHolders(RbacIds.SUPER_ADMIN_ROLE_ID) <= 1) {
      throw new ConflictException(message).withCode(LAST_SUPER_ADMIN);
    }
  }
}
