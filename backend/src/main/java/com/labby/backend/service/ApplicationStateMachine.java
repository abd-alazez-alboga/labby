package com.labby.backend.service;

import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.exception.ConflictException;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * The driver application state machine (DRV-02, onboarding-v1.yaml): {@code submitted →
 * under_review → needs_changes → under_review → … → approved | rejected}. A first application or a
 * reapplication after rejection enters {@code submitted}; the three decisions are legal only from
 * {@code under_review}; a resubmission returns {@code needs_changes} to {@code under_review};
 * {@code approved} is terminal. Deleting the account withdraws an open application ({@code
 * submitted}, {@code under_review}, {@code needs_changes} → {@code withdrawn}); a withdrawn
 * application, like a rejected one, may reapply. Illegal transitions are 409.
 */
public final class ApplicationStateMachine {

  private static final Map<ApplicationStatus, Set<ApplicationStatus>> TRANSITIONS =
      Map.of(
          ApplicationStatus.SUBMITTED,
              EnumSet.of(ApplicationStatus.UNDER_REVIEW, ApplicationStatus.WITHDRAWN),
          ApplicationStatus.UNDER_REVIEW,
              EnumSet.of(
                  ApplicationStatus.NEEDS_CHANGES,
                  ApplicationStatus.APPROVED,
                  ApplicationStatus.REJECTED,
                  ApplicationStatus.WITHDRAWN),
          ApplicationStatus.NEEDS_CHANGES,
              EnumSet.of(ApplicationStatus.UNDER_REVIEW, ApplicationStatus.WITHDRAWN),
          ApplicationStatus.APPROVED, EnumSet.noneOf(ApplicationStatus.class),
          ApplicationStatus.REJECTED, EnumSet.of(ApplicationStatus.SUBMITTED),
          ApplicationStatus.WITHDRAWN, EnumSet.of(ApplicationStatus.SUBMITTED));

  private ApplicationStateMachine() {}

  /**
   * Whether the transition is legal. {@code from == null} means "never applied", from which only
   * {@code submitted} is reachable.
   *
   * @param from the current stage, or null
   * @param to the target stage
   * @return true when legal
   */
  public static boolean canTransition(ApplicationStatus from, ApplicationStatus to) {
    if (from == null) {
      return to == ApplicationStatus.SUBMITTED;
    }
    return TRANSITIONS.get(from).contains(to);
  }

  /**
   * Asserts the transition is legal.
   *
   * @param from the current stage, or null when never applied
   * @param to the target stage
   * @throws ConflictException when illegal (409)
   */
  public static void requireTransition(ApplicationStatus from, ApplicationStatus to) {
    if (!canTransition(from, to)) {
      throw new ConflictException(
          "The application cannot move from %s to %s"
              .formatted(from == null ? "none" : from.getValue(), to.getValue()));
    }
  }
}
