package com.labby.backend.service;

import java.util.UUID;

/**
 * The driver role's lifecycle around onboarding (USR-01, USR-04, DRV-04): granted on approval,
 * auto-suspended for an expired current document, reinstated once no current document is expired.
 * Only the {@code document_expired} reason is ever lifted here; other suspensions stay.
 */
public interface DriverRoleService {

  /**
   * Grants the driver role on application approval: creates it active, or — when the account
   * already holds a suspended driver role — lifts it only if the suspension is for document expiry
   * and no current document is expired (other suspensions are never lifted here).
   *
   * @param userId the approved driver
   */
  void grantDriverRole(UUID userId);

  /**
   * Suspends an ACTIVE driver role with reason {@code document_expired} and queues {@code
   * driver.suspended}. A role that is already suspended (for any reason) is left untouched.
   *
   * @param userId the driver
   * @return true when the role was suspended now
   */
  boolean suspendForExpiredDocument(UUID userId);

  /**
   * Lifts a {@code document_expired} suspension once no current document (ID, licence, active
   * vehicle's registration/insurance) is expired, and queues {@code driver.reinstated}.
   *
   * @param userId the driver
   * @return true when the role was reinstated now
   */
  boolean reinstateIfNoExpiredDocument(UUID userId);

  /**
   * Whether the driver role is suspended for document expiry.
   *
   * @param userId the driver
   * @return true when suspended with reason {@code document_expired}
   */
  boolean isSuspendedForExpiry(UUID userId);

  /**
   * Whether the driver role is suspended for any reason.
   *
   * @param userId the driver
   * @return true when suspended
   */
  boolean isSuspended(UUID userId);

  /**
   * Whether a current document (approved ID/licence, the active vehicle's registration/insurance)
   * is expired today — DRV-04's condition, also checked when an admin reactivates the driver role
   * (M11 review B-W4).
   *
   * @param userId the driver
   * @return true when a current document is expired
   */
  boolean hasExpiredCurrentDocument(UUID userId);
}
