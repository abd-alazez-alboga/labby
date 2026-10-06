package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.service.ApplicationStateMachine;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * DRV-02 state machine: submitted → under_review → needs_changes → under_review → … → approved |
 * rejected; reapply after rejection; approved is terminal. Every other transition is a 409.
 */
class ApplicationStateMachineTest {

  private static final Map<ApplicationStatus, Set<ApplicationStatus>> LEGAL =
      Map.of(
          ApplicationStatus.SUBMITTED, EnumSet.of(ApplicationStatus.UNDER_REVIEW),
          ApplicationStatus.UNDER_REVIEW,
              EnumSet.of(
                  ApplicationStatus.NEEDS_CHANGES,
                  ApplicationStatus.APPROVED,
                  ApplicationStatus.REJECTED),
          ApplicationStatus.NEEDS_CHANGES, EnumSet.of(ApplicationStatus.UNDER_REVIEW),
          ApplicationStatus.APPROVED, EnumSet.noneOf(ApplicationStatus.class),
          ApplicationStatus.REJECTED, EnumSet.of(ApplicationStatus.SUBMITTED));

  @Test
  @DisplayName("exactly the contract's transitions are legal, every other pair is not")
  void shouldAllowExactlyTheContractTransitions() {
    for (ApplicationStatus from : ApplicationStatus.values()) {
      for (ApplicationStatus to : ApplicationStatus.values()) {
        assertThat(ApplicationStateMachine.canTransition(from, to))
            .as("%s -> %s", from, to)
            .isEqualTo(LEGAL.get(from).contains(to));
      }
    }
  }

  @Test
  @DisplayName("a first application can only be submitted")
  void shouldOnlySubmitWhenNeverApplied() {
    for (ApplicationStatus to : ApplicationStatus.values()) {
      assertThat(ApplicationStateMachine.canTransition(null, to))
          .isEqualTo(to == ApplicationStatus.SUBMITTED);
    }
  }

  @Test
  @DisplayName("illegal transitions are 409 conflicts naming both stages")
  void shouldThrowConflictOnIllegalTransition() {
    assertThatThrownBy(
            () ->
                ApplicationStateMachine.requireTransition(
                    ApplicationStatus.APPROVED, ApplicationStatus.REJECTED))
        .isInstanceOf(ConflictException.class)
        .hasMessageContaining("approved")
        .hasMessageContaining("rejected");
    assertThatThrownBy(
            () ->
                ApplicationStateMachine.requireTransition(
                    ApplicationStatus.SUBMITTED, ApplicationStatus.APPROVED))
        .isInstanceOf(ConflictException.class);
    assertThatCode(
            () ->
                ApplicationStateMachine.requireTransition(
                    ApplicationStatus.NEEDS_CHANGES, ApplicationStatus.UNDER_REVIEW))
        .doesNotThrowAnyException();
  }
}
