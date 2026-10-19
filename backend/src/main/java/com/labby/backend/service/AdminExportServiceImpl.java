package com.labby.backend.service;

import com.labby.backend.config.AnalyticsProperties;
import com.labby.backend.dto.AdminDriverDto;
import com.labby.backend.dto.AdminRideSummaryDto;
import com.labby.backend.dto.AdminTicketDto;
import com.labby.backend.dto.AdminTransactionDto;
import com.labby.backend.dto.AdminUserDto;
import com.labby.backend.dto.CsvFileDto;
import com.labby.backend.dto.PlaceDto;
import com.labby.backend.repository.AnalyticsRepository;
import com.labby.backend.util.CsvWriter;
import java.time.Clock;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Columns per analytics-v1.yaml {@code Csv}. Read-write transaction: the audit entry is written
 * with the export, so a failed export leaves no audit row and an audited one really ran.
 */
@Service
@RequiredArgsConstructor
public class AdminExportServiceImpl implements AdminExportService {

  private static final DateTimeFormatter STAMP =
      DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneOffset.UTC);
  private static final String TARGET = "export";

  private final AdminRideService adminRideService;
  private final AdminDirectoryService adminDirectoryService;
  private final SupportTicketService supportTicketService;
  private final AuditService auditService;
  private final AnalyticsRepository analyticsRepository;
  private final AnalyticsProperties analyticsProperties;
  private final Clock clock;

  @Override
  @Transactional
  public CsvFileDto rides(UUID adminUserId, AdminRideService.Filter filter) {
    limit();
    CsvWriter csv =
        new CsvWriter(
            List.of(
                "ride_id",
                "requested_at",
                "state",
                "kind",
                "region",
                "service_type",
                "rider_id",
                "rider_name",
                "driver_id",
                "driver_name",
                "fare_total",
                "cancellation_fee",
                "currency",
                "pickup",
                "destination"));
    for (AdminRideSummaryDto ride : adminRideService.searchAll(filter, maxRows())) {
      csv.row(
          ride.id(),
          ride.requestedAt(),
          ride.state().getValue(),
          ride.kind().getValue(),
          ride.regionName(),
          ride.serviceTypeNameEn(),
          ride.riderUserId(),
          ride.riderName(),
          ride.driverUserId(),
          ride.driverName(),
          ride.total(),
          ride.cancellationFee(),
          ride.currency(),
          place(ride.pickup()),
          place(ride.destination()));
    }
    return finish("rides", adminUserId, filter, csv);
  }

  @Override
  @Transactional
  public CsvFileDto users(
      UUID adminUserId, AdminDirectoryService.UserFilter filter, boolean contactAccess) {
    limit();
    CsvWriter csv =
        new CsvWriter(List.of("user_id", "name", "phone", "state", "roles", "created_at"));
    for (AdminUserDto user : adminDirectoryService.allUsers(filter, maxRows())) {
      csv.row(
          user.userId(),
          user.name(),
          contactAccess ? user.phone() : null,
          user.state().getValue(),
          user.roles().stream()
              .map(role -> role.role().getValue())
              .collect(Collectors.joining(";")),
          user.createdAt());
    }
    return finish("users", adminUserId, filter, csv);
  }

  @Override
  @Transactional
  public CsvFileDto drivers(
      UUID adminUserId, AdminDirectoryService.DriverFilter filter, boolean contactAccess) {
    limit();
    CsvWriter csv =
        new CsvWriter(
            List.of(
                "user_id",
                "name",
                "phone",
                "application_status",
                "online",
                "region",
                "vehicle_plate",
                "created_at"));
    for (AdminDriverDto driver : adminDirectoryService.allDrivers(filter, maxRows())) {
      csv.row(
          driver.userId(),
          driver.name(),
          contactAccess ? driver.phone() : null,
          driver.applicationStatus().getValue(),
          driver.online(),
          driver.regionName(),
          driver.vehiclePlate(),
          driver.createdAt());
    }
    return finish("drivers", adminUserId, filter, csv);
  }

  @Override
  @Transactional
  public CsvFileDto transactions(UUID adminUserId, AdminDirectoryService.TransactionFilter filter) {
    limit();
    CsvWriter csv =
        new CsvWriter(
            List.of(
                "transaction_id",
                "source",
                "created_at",
                "user_id",
                "user_name",
                "type",
                "amount",
                "currency",
                "ride_id",
                "balance_after",
                "reason"));
    for (AdminTransactionDto row : adminDirectoryService.allTransactions(filter, maxRows())) {
      csv.row(
          row.transactionId(),
          row.source().getValue(),
          row.createdAt(),
          row.userId(),
          row.userName(),
          row.type(),
          row.amount(),
          row.currency(),
          row.rideId(),
          row.balanceAfter(),
          row.reason());
    }
    return finish("transactions", adminUserId, filter, csv);
  }

  @Override
  @Transactional
  public CsvFileDto tickets(UUID adminUserId, SupportTicketService.AdminTicketFilter filter) {
    limit();
    CsvWriter csv =
        new CsvWriter(
            List.of(
                "ticket_id",
                "kind",
                "status",
                "priority",
                "category",
                "user_id",
                "user_name",
                "user_role",
                "assignee",
                "ride_id",
                "created_at",
                "last_message_at",
                "description"));
    for (AdminTicketDto ticket : supportTicketService.adminQueueAll(filter, maxRows())) {
      csv.row(
          ticket.ticket().ticketId(),
          ticket.ticket().kind().getValue(),
          ticket.ticket().status().getValue(),
          ticket.ticket().priority().getValue(),
          ticket.ticket().category() == null ? null : ticket.ticket().category().name().en(),
          ticket.user() == null ? null : ticket.user().userId(),
          ticket.user() == null ? null : ticket.user().name(),
          ticket.user() == null || ticket.user().role() == null
              ? null
              : ticket.user().role().getValue(),
          ticket.assignee() == null ? null : ticket.assignee().name(),
          ticket.ticket().ride() == null ? null : ticket.ticket().ride().rideId(),
          ticket.ticket().createdAt(),
          ticket.ticket().lastMessageAt(),
          ticket.ticket().description());
    }
    return finish("tickets", adminUserId, filter, csv);
  }

  private void limit() {
    analyticsRepository.limitStatementTime(analyticsProperties.statementTimeout());
  }

  private int maxRows() {
    return analyticsProperties.exportMaxRows();
  }

  private CsvFileDto finish(String list, UUID adminUserId, Object filter, CsvWriter csv) {
    auditService.record(
        adminUserId,
        "export." + list,
        TARGET,
        list,
        null,
        Map.of("filters", filter, "rows", csv.rows()));
    return new CsvFileDto(
        "labby-" + list + "-" + STAMP.format(clock.instant()) + "Z.csv", csv.toBytes(), csv.rows());
  }

  private static String place(PlaceDto place) {
    if (place == null) {
      return null;
    }
    return place.label() != null ? place.label() : place.lat() + "," + place.lng();
  }
}
