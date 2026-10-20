package com.labby.backend.service;

import com.labby.backend.config.AnalyticsProperties;
import com.labby.backend.dto.AdminDriverDto;
import com.labby.backend.dto.AdminDriverPageDto;
import com.labby.backend.dto.AdminTransactionDto;
import com.labby.backend.dto.AdminTransactionPageDto;
import com.labby.backend.dto.AdminUserDto;
import com.labby.backend.dto.AdminUserDto.RoleDto;
import com.labby.backend.dto.AdminUserPageDto;
import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import com.labby.backend.enums.TransactionSource;
import com.labby.backend.repository.AdminDirectoryRepository;
import com.labby.backend.repository.AdminDirectoryRepository.DriverRow;
import com.labby.backend.repository.AdminDirectoryRepository.TransactionRow;
import com.labby.backend.repository.AdminDirectoryRepository.UserRow;
import com.labby.backend.repository.AnalyticsRepository;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read-only; the page and the export share the repository's one where-clause per list. A page runs
 * its count and rows under the analytics {@code statement_timeout} (503 {@code query_timeout}),
 * exactly as the export does; the offset is computed as a long, so a page past the end is empty.
 */
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class AdminDirectoryServiceImpl implements AdminDirectoryService {

  private final AdminDirectoryRepository repository;
  private final AnalyticsRepository analyticsRepository;
  private final AnalyticsProperties analyticsProperties;

  @Override
  public AdminUserPageDto users(UserFilter filter, int page, int size) {
    limit();
    long total = repository.countUsers(role(filter), filter.from(), filter.to(), filter.q());
    return new AdminUserPageDto(userRows(filter, size, offset(page, size)), page, size, total);
  }

  @Override
  public List<AdminUserDto> allUsers(UserFilter filter, int maxRows) {
    ExportLimits.check(
        repository.countUsers(role(filter), filter.from(), filter.to(), filter.q()), maxRows);
    return userRows(filter, maxRows, 0);
  }

  private List<AdminUserDto> userRows(UserFilter filter, int limit, long offset) {
    List<UserRow> rows =
        repository.users(role(filter), filter.from(), filter.to(), filter.q(), limit, offset);
    Map<UUID, List<RoleDto>> roles =
        repository.roles(rows.stream().map(UserRow::userId).toList()).stream()
            .collect(
                Collectors.groupingBy(
                    AdminDirectoryRepository.UserRoleRow::userId,
                    Collectors.mapping(
                        row ->
                            new RoleDto(
                                Role.fromValue(row.role()), RoleState.fromValue(row.state())),
                        Collectors.toList())));
    return rows.stream()
        .map(
            row ->
                new AdminUserDto(
                    row.userId(),
                    row.name(),
                    row.phone(),
                    AccountState.fromValue(row.state()),
                    roles.getOrDefault(row.userId(), List.of()),
                    row.createdAt()))
        .toList();
  }

  private void limit() {
    analyticsRepository.limitStatementTime(analyticsProperties.statementTimeout());
  }

  private static long offset(int page, int size) {
    return (long) page * size;
  }

  private static String role(UserFilter filter) {
    return filter.role() == null ? null : filter.role().getValue();
  }

  @Override
  public AdminDriverPageDto drivers(DriverFilter filter, int page, int size) {
    limit();
    long total = countDrivers(filter);
    return new AdminDriverPageDto(driverRows(filter, size, offset(page, size)), page, size, total);
  }

  @Override
  public List<AdminDriverDto> allDrivers(DriverFilter filter, int maxRows) {
    ExportLimits.check(countDrivers(filter), maxRows);
    return driverRows(filter, maxRows, 0);
  }

  private long countDrivers(DriverFilter filter) {
    return repository.countDrivers(filter.regionId(), status(filter), filter.online());
  }

  private List<AdminDriverDto> driverRows(DriverFilter filter, int limit, long offset) {
    return repository
        .drivers(filter.regionId(), status(filter), filter.online(), limit, offset)
        .stream()
        .map(AdminDirectoryServiceImpl::driver)
        .toList();
  }

  private static AdminDriverDto driver(DriverRow row) {
    return new AdminDriverDto(
        row.userId(),
        row.name(),
        row.phone(),
        ApplicationStatus.fromValue(row.applicationStatus()),
        row.online(),
        row.regionId(),
        row.regionName(),
        row.vehiclePlate(),
        row.createdAt());
  }

  private static String status(DriverFilter filter) {
    return filter.status() == null ? null : filter.status().getValue();
  }

  @Override
  public AdminTransactionPageDto transactions(TransactionFilter filter, int page, int size) {
    limit();
    long total = countTransactions(filter);
    return new AdminTransactionPageDto(
        transactionRows(filter, size, offset(page, size)), page, size, total);
  }

  @Override
  public List<AdminTransactionDto> allTransactions(TransactionFilter filter, int maxRows) {
    ExportLimits.check(countTransactions(filter), maxRows);
    return transactionRows(filter, maxRows, 0);
  }

  private long countTransactions(TransactionFilter filter) {
    return repository.countTransactions(
        source(filter),
        filter.type(),
        filter.currency(),
        filter.userId(),
        filter.from(),
        filter.to());
  }

  private List<AdminTransactionDto> transactionRows(
      TransactionFilter filter, int limit, long offset) {
    return repository
        .transactions(
            source(filter),
            filter.type(),
            filter.currency(),
            filter.userId(),
            filter.from(),
            filter.to(),
            limit,
            offset)
        .stream()
        .map(AdminDirectoryServiceImpl::transaction)
        .toList();
  }

  private static AdminTransactionDto transaction(TransactionRow row) {
    return new AdminTransactionDto(
        row.transactionId(),
        TransactionSource.fromValue(row.source()),
        row.userId(),
        row.userName(),
        row.type(),
        row.amount(),
        row.currency(),
        row.rideId(),
        row.balanceAfter(),
        row.reason(),
        row.createdAt());
  }

  private static String source(TransactionFilter filter) {
    return filter.source() == null ? null : filter.source().getValue();
  }
}
