package com.labby.backend.dto;

import com.fasterxml.jackson.annotation.JsonUnwrapped;
import com.labby.backend.enums.ChatWindowState;
import java.util.List;
import java.util.UUID;

/**
 * Everything the handler needs (support-v1 {@code AdminTicketDetail}): thread, history, the user's
 * phone for {@code support:handle} holders only, and the lost-item facts on a case.
 */
public record AdminTicketDetailDto(
    @JsonUnwrapped AdminTicketDto ticket,
    List<TicketMessageDto> messages,
    List<TicketEventDto> events,
    String userPhone,
    LostItemInfoDto lostItem) {

  /**
   * The driver and the reopened chat the handler can read (comms-v1 admin chat); {@code memberId}
   * addresses the reporter's thread on a shared ride (T6 amendment h, null otherwise).
   */
  public record LostItemInfoDto(
      PartySummaryDto driver, ChatWindowState chatWindow, UUID memberId) {}

  /**
   * The same detail with the user's phone withheld (contact access, M10 rule).
   *
   * @return the detail without {@code userPhone}
   */
  public AdminTicketDetailDto withoutPhone() {
    return new AdminTicketDetailDto(ticket, messages, events, null, lostItem);
  }
}
