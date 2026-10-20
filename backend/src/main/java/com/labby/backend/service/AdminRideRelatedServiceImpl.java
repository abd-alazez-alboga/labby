package com.labby.backend.service;

import com.labby.backend.dto.AdminRideRelatedDto;
import com.labby.backend.dto.PartySummaryDto;
import com.labby.backend.enums.CaseStatus;
import com.labby.backend.enums.ReportCategory;
import com.labby.backend.enums.ReportStatus;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.TicketPriority;
import com.labby.backend.enums.TicketStatus;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.repository.AdminRideRelatedRepository;
import com.labby.backend.repository.AdminRideRelatedRepository.TicketRow;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read-only; one query per section, run only for the sections the caller may see. */
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class AdminRideRelatedServiceImpl implements AdminRideRelatedService {

  /** The longest ticket / case summary served. */
  static final int SUMMARY_MAX = 120;

  private static final String LOST_ITEM = "lost_item";

  private final AdminRideRelatedRepository repository;

  @Override
  public AdminRideRelatedDto related(UUID rideId, boolean withReports, boolean withSupport) {
    if (!repository.rideExists(rideId)) {
      throw new ResourceNotFoundException("Ride not found");
    }
    List<AdminRideRelatedDto.Report> reports = withReports ? reports(rideId) : null;
    if (!withSupport) {
      return new AdminRideRelatedDto(rideId, reports, null, null, null);
    }
    List<TicketRow> tickets = repository.tickets(rideId);
    return new AdminRideRelatedDto(
        rideId,
        reports,
        tickets.stream()
            .filter(row -> !LOST_ITEM.equals(row.kind()))
            .map(AdminRideRelatedServiceImpl::ticket)
            .toList(),
        tickets.stream()
            .filter(row -> LOST_ITEM.equals(row.kind()))
            .map(AdminRideRelatedServiceImpl::lostItem)
            .toList(),
        repository.sosEvents(rideId).stream()
            .map(
                row ->
                    new AdminRideRelatedDto.Sos(
                        row.sosEventId(),
                        ref(row.sosEventId()),
                        party(
                            row.triggeredByUserId(), row.triggeredByName(), row.triggeredByRole()),
                        row.triggeredAt(),
                        row.acknowledgedAt() != null,
                        row.acknowledgedAt(),
                        row.ticketId()))
            .toList());
  }

  private List<AdminRideRelatedDto.Report> reports(UUID rideId) {
    return repository.reports(rideId).stream()
        .map(
            row ->
                new AdminRideRelatedDto.Report(
                    row.reportId(),
                    ref(row.reportId()),
                    ReportCategory.fromValue(row.category()),
                    ReportStatus.fromValue(row.status()),
                    party(row.reporterUserId(), row.reporterName(), row.reporterRole()),
                    party(row.reportedUserId(), row.reportedName(), row.reportedRole()),
                    row.createdAt()))
        .toList();
  }

  private static AdminRideRelatedDto.Ticket ticket(TicketRow row) {
    return new AdminRideRelatedDto.Ticket(
        row.ticketId(),
        ref(row.ticketId()),
        row.categoryId(),
        row.categoryNameEn(),
        row.categoryNameAr(),
        summary(row.description()),
        TicketStatus.fromValue(row.status()),
        TicketPriority.fromValue(row.priority()),
        party(row.userId(), row.userName(), row.submittedAs()),
        row.sosEventId(),
        row.createdAt());
  }

  private static AdminRideRelatedDto.LostItem lostItem(TicketRow row) {
    return new AdminRideRelatedDto.LostItem(
        row.ticketId(),
        ref(row.ticketId()),
        summary(row.description()),
        CaseStatus.fromValue(row.caseStatus()),
        TicketStatus.fromValue(row.status()),
        party(row.userId(), row.userName(), row.submittedAs()),
        row.createdAt());
  }

  private static PartySummaryDto party(UUID userId, String name, String role) {
    return new PartySummaryDto(userId, name, RideParty.fromValue(role));
  }

  /** The id's first 8 hex digits, upper-case (the apps' R- / T- / L- references). */
  static String ref(UUID id) {
    return id.toString().substring(0, 8).toUpperCase(Locale.ROOT);
  }

  /** The description's first line, cut to {@link #SUMMARY_MAX} characters. */
  static String summary(String description) {
    String firstLine = description.strip().lines().findFirst().orElse("").strip();
    return firstLine.length() <= SUMMARY_MAX
        ? firstLine
        : firstLine.substring(0, SUMMARY_MAX - 1).stripTrailing() + "…";
  }
}
