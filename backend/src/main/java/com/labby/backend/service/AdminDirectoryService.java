package com.labby.backend.service;

import com.labby.backend.dto.AdminDriverDto;
import com.labby.backend.dto.AdminDriverPageDto;
import com.labby.backend.dto.AdminTransactionDto;
import com.labby.backend.dto.AdminTransactionPageDto;
import com.labby.backend.dto.AdminUserDto;
import com.labby.backend.dto.AdminUserPageDto;
import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.TransactionSource;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The admin users / drivers / transactions lists (analytics-v1.yaml, M15 ruling Q1). Each list's
 * {@code all} variant is its CSV export: the same filter and order, every row, at most {@code
 * maxRows} (422 {@code export_too_large} above). Rows carry the phone; callers strip it for admins
 * without contact access.
 */
public interface AdminDirectoryService {

  /**
   * Users-list filters; every one optional. {@code q} is the search box (H8): a user id, or a
   * case-insensitive partial name, or a phone in any format (matched after {@code
   * PhoneNumbers.normalize}); trimmed, blank = none.
   */
  record UserFilter(Role role, Instant from, Instant to, String q) {

    /** No search. */
    public UserFilter(Role role, Instant from, Instant to) {
      this(role, from, to, null);
    }
  }

  /** Drivers-list filters; every one optional. */
  record DriverFilter(UUID regionId, ApplicationStatus status, Boolean online) {}

  /**
   * Transactions-list filters; every one optional. {@code type} is a wallet transaction or driver
   * ledger type value, already validated.
   */
  record TransactionFilter(
      TransactionSource source,
      String type,
      String currency,
      UUID userId,
      Instant from,
      Instant to) {}

  /**
   * Users, newest first.
   *
   * @param filter the filters
   * @param page zero-based page
   * @param size page size
   * @return one page
   */
  AdminUserPageDto users(UserFilter filter, int page, int size);

  /**
   * Every user of the filter, list order.
   *
   * @param filter the filters
   * @param maxRows the export cap
   * @return the rows
   */
  List<AdminUserDto> allUsers(UserFilter filter, int maxRows);

  /**
   * Drivers, newest account first.
   *
   * @param filter the filters
   * @param page zero-based page
   * @param size page size
   * @return one page
   */
  AdminDriverPageDto drivers(DriverFilter filter, int page, int size);

  /**
   * Every driver of the filter, list order.
   *
   * @param filter the filters
   * @param maxRows the export cap
   * @return the rows
   */
  List<AdminDriverDto> allDrivers(DriverFilter filter, int maxRows);

  /**
   * Wallet transactions + driver ledger entries, newest first.
   *
   * @param filter the filters
   * @param page zero-based page
   * @param size page size
   * @return one page
   */
  AdminTransactionPageDto transactions(TransactionFilter filter, int page, int size);

  /**
   * Every transaction of the filter, list order.
   *
   * @param filter the filters
   * @param maxRows the export cap
   * @return the rows
   */
  List<AdminTransactionDto> allTransactions(TransactionFilter filter, int maxRows);
}
