package com.labby.backend.unit.enums;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.enums.CaseStatus;
import com.labby.backend.enums.TicketStatus;
import java.util.EnumSet;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The two M14 state machines as the support-v1 header documents them. */
class SupportStateMachinesTest {

  private static Set<TicketStatus> ticketTargets(TicketStatus from) {
    Set<TicketStatus> targets = EnumSet.noneOf(TicketStatus.class);
    for (TicketStatus target : TicketStatus.values()) {
      if (from.canMoveTo(target)) {
        targets.add(target);
      }
    }
    return targets;
  }

  private static Set<CaseStatus> caseTargets(CaseStatus from) {
    Set<CaseStatus> targets = EnumSet.noneOf(CaseStatus.class);
    for (CaseStatus target : CaseStatus.values()) {
      if (from.canMoveTo(target)) {
        targets.add(target);
      }
    }
    return targets;
  }

  @Test
  @DisplayName(
      "SUP-02: open -> in_progress -> waiting_on_user -> resolved -> closed, closed terminal")
  void ticketMachine() {
    assertThat(ticketTargets(TicketStatus.OPEN)).containsExactly(TicketStatus.IN_PROGRESS);
    assertThat(ticketTargets(TicketStatus.IN_PROGRESS))
        .containsExactlyInAnyOrder(TicketStatus.WAITING_ON_USER, TicketStatus.RESOLVED);
    assertThat(ticketTargets(TicketStatus.WAITING_ON_USER))
        .containsExactly(TicketStatus.IN_PROGRESS);
    assertThat(ticketTargets(TicketStatus.RESOLVED))
        .containsExactlyInAnyOrder(TicketStatus.IN_PROGRESS, TicketStatus.CLOSED);
    assertThat(ticketTargets(TicketStatus.CLOSED)).isEmpty();
  }

  @Test
  @DisplayName("LOST-02: the case machine and its mirrored ticket status")
  void caseMachine() {
    assertThat(caseTargets(CaseStatus.REPORTED)).containsExactly(CaseStatus.DRIVER_CONTACTED);
    assertThat(caseTargets(CaseStatus.DRIVER_CONTACTED))
        .containsExactlyInAnyOrder(CaseStatus.FOUND, CaseStatus.NOT_FOUND);
    assertThat(caseTargets(CaseStatus.FOUND)).containsExactly(CaseStatus.RETURNED);
    assertThat(caseTargets(CaseStatus.NOT_FOUND)).containsExactly(CaseStatus.CLOSED);
    assertThat(caseTargets(CaseStatus.RETURNED)).containsExactly(CaseStatus.CLOSED);
    assertThat(caseTargets(CaseStatus.CLOSED)).isEmpty();
    assertThat(CaseStatus.REPORTED.ticketStatus()).isEqualTo(TicketStatus.OPEN);
    assertThat(CaseStatus.DRIVER_CONTACTED.ticketStatus()).isEqualTo(TicketStatus.IN_PROGRESS);
    assertThat(CaseStatus.FOUND.ticketStatus()).isEqualTo(TicketStatus.IN_PROGRESS);
    assertThat(CaseStatus.NOT_FOUND.ticketStatus()).isEqualTo(TicketStatus.RESOLVED);
    assertThat(CaseStatus.RETURNED.ticketStatus()).isEqualTo(TicketStatus.RESOLVED);
    assertThat(CaseStatus.CLOSED.ticketStatus()).isEqualTo(TicketStatus.CLOSED);
  }
}
