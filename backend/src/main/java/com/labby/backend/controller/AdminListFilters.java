package com.labby.backend.controller;

import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.enums.DriverLedgerType;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.TicketKind;
import com.labby.backend.enums.TicketPriority;
import com.labby.backend.enums.TicketStatus;
import com.labby.backend.enums.TransactionSource;
import com.labby.backend.enums.WalletTransactionType;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.service.AdminDirectoryService;
import com.labby.backend.service.AdminRideService;
import com.labby.backend.service.SupportTicketService;
import com.labby.backend.util.WireEnums;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.function.Function;

/**
 * The query-parameter parsing of the admin lists, shared by each list endpoint and its CSV export
 * (analytics-v1.yaml): one parser per list, so an export filters exactly like the screen it came
 * from.
 */
final class AdminListFilters {

  private AdminListFilters() {}

  /** The rides-v1 {@code GET /admin/rides} filters. */
  static AdminRideService.Filter rides(
      UUID regionId,
      String state,
      String kind,
      UUID userId,
      String phone,
      Instant from,
      Instant to) {
    return new AdminRideService.Filter(
        regionId,
        strict(state, RideState::fromValue, "state"),
        strict(kind, RideKind::fromValue, "kind"),
        userId,
        phone,
        from,
        to);
  }

  /** The support-v1 {@code GET /admin/tickets} filters. */
  static SupportTicketService.AdminTicketFilter tickets(
      String kind,
      List<String> status,
      String priority,
      UUID categoryId,
      UUID assigneeUserId,
      Boolean unassigned,
      UUID userId,
      UUID rideId) {
    return new SupportTicketService.AdminTicketFilter(
        WireEnums.parse(TicketKind::fromValue, kind, "kind"),
        WireEnums.parseAll(TicketStatus::fromValue, status, "status"),
        WireEnums.parse(TicketPriority::fromValue, priority, "priority"),
        categoryId,
        assigneeUserId,
        unassigned,
        userId,
        rideId);
  }

  /** The analytics-v1 {@code GET /admin/users} filters. */
  static AdminDirectoryService.UserFilter users(String role, Instant from, Instant to) {
    return new AdminDirectoryService.UserFilter(
        WireEnums.parse(Role::fromValue, role, "role"), from, to);
  }

  /** The analytics-v1 {@code GET /admin/drivers} filters. */
  static AdminDirectoryService.DriverFilter drivers(UUID regionId, String status, Boolean online) {
    return new AdminDirectoryService.DriverFilter(
        regionId, WireEnums.parse(ApplicationStatus::fromValue, status, "status"), online);
  }

  /**
   * The analytics-v1 {@code GET /admin/transactions} filters; {@code type} must be a wallet
   * transaction or a driver ledger type value.
   */
  static AdminDirectoryService.TransactionFilter transactions(
      String source, String type, String currency, UUID userId, Instant from, Instant to) {
    String normalizedType =
        type == null || type.isBlank() ? null : type.trim().toLowerCase(Locale.ROOT);
    if (normalizedType != null && !isLedgerType(normalizedType)) {
      throw new InvalidRequestException("Unknown type: " + type);
    }
    return new AdminDirectoryService.TransactionFilter(
        WireEnums.parse(TransactionSource::fromValue, source, "source"),
        normalizedType,
        currency == null || currency.isBlank() ? null : currency.trim().toUpperCase(Locale.ROOT),
        userId,
        from,
        to);
  }

  private static boolean isLedgerType(String type) {
    for (WalletTransactionType candidate : WalletTransactionType.values()) {
      if (candidate.getValue().equals(type)) {
        return true;
      }
    }
    for (DriverLedgerType candidate : DriverLedgerType.values()) {
      if (candidate.getValue().equals(type)) {
        return true;
      }
    }
    return false;
  }

  /** The rides list's parsing: a present value must be known (blank included). */
  private static <T> T strict(String value, Function<String, T> parser, String name) {
    if (value == null) {
      return null;
    }
    try {
      return parser.apply(value);
    } catch (IllegalArgumentException ex) {
      throw new InvalidRequestException("Unknown " + name + ": " + value);
    }
  }
}
