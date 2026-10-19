package com.labby.backend.repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * The M15 admin users / drivers / transactions lists (analytics-v1.yaml, ruling Q1). Each list has
 * ONE where-clause builder shared by its page, its count and its CSV export, so an export holds
 * exactly the rows the list shows under the same filters. Every filter is optional (null = any).
 */
@Repository
@RequiredArgsConstructor
public class AdminDirectoryRepository {

  private final NamedParameterJdbcTemplate namedJdbcTemplate;

  /** A users-list row. */
  public record UserRow(UUID userId, String name, String phone, String state, Instant createdAt) {}

  /** One role of a listed user. */
  public record UserRoleRow(UUID userId, String role, String state) {}

  /** A drivers-list row; region and plate are the active vehicle's (null without one). */
  public record DriverRow(
      UUID userId,
      String name,
      String phone,
      String applicationStatus,
      boolean online,
      UUID regionId,
      String regionName,
      String vehiclePlate,
      Instant createdAt) {}

  /** A transactions-list row: {@code source} is {@code wallet} or {@code driver_ledger}. */
  public record TransactionRow(
      UUID transactionId,
      String source,
      UUID userId,
      String userName,
      String type,
      BigDecimal amount,
      String currency,
      UUID rideId,
      BigDecimal balanceAfter,
      String reason,
      Instant createdAt) {}

  // ---- users ------------------------------------------------------------------------------------

  /**
   * Users newest first.
   *
   * @param role holds this role (any state), or null
   * @param from createdAt lower bound (inclusive), or null
   * @param to createdAt upper bound (exclusive), or null
   * @param limit rows
   * @param offset rows skipped
   * @return the rows
   */
  public List<UserRow> users(String role, Instant from, Instant to, int limit, int offset) {
    MapSqlParameterSource params = new MapSqlParameterSource();
    return namedJdbcTemplate.query(
        "SELECT u.user_id, u.name, u.phone, u.state, u.created_at FROM users u"
            + userWhere(role, from, to, params)
            + " ORDER BY u.created_at DESC, u.user_id"
            + page(limit, offset, params),
        params,
        (rs, i) ->
            new UserRow(
                rs.getObject("user_id", UUID.class),
                rs.getString("name"),
                rs.getString("phone"),
                rs.getString("state"),
                instant(rs, "created_at")));
  }

  /**
   * The users-list count under the same filters.
   *
   * @param role see {@link #users}
   * @param from see {@link #users}
   * @param to see {@link #users}
   * @return the count
   */
  public long countUsers(String role, Instant from, Instant to) {
    MapSqlParameterSource params = new MapSqlParameterSource();
    return namedJdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM users u" + userWhere(role, from, to, params), params, Long.class);
  }

  /**
   * The roles of the given users, by role.
   *
   * @param userIds the users
   * @return the rows
   */
  public List<UserRoleRow> roles(Collection<UUID> userIds) {
    if (userIds.isEmpty()) {
      return List.of();
    }
    return namedJdbcTemplate.query(
        "SELECT user_id, role, state FROM role_assignments WHERE user_id IN (:ids) ORDER BY role",
        new MapSqlParameterSource("ids", userIds),
        (rs, i) ->
            new UserRoleRow(
                rs.getObject("user_id", UUID.class), rs.getString("role"), rs.getString("state")));
  }

  private static String userWhere(
      String role, Instant from, Instant to, MapSqlParameterSource params) {
    StringBuilder where = new StringBuilder(" WHERE true");
    if (role != null) {
      where.append(
          " AND EXISTS (SELECT 1 FROM role_assignments a WHERE a.user_id = u.user_id"
              + " AND a.role = :role)");
      params.addValue("role", role);
    }
    range(where, "u.created_at", from, to, params);
    return where.toString();
  }

  // ---- drivers ----------------------------------------------------------------------------------

  /**
   * Users with a driver application, newest account first.
   *
   * @param regionId the active vehicle serves a service type of this region, or null
   * @param status the application status, or null
   * @param online the online flag, or null
   * @param limit rows
   * @param offset rows skipped
   * @return the rows
   */
  public List<DriverRow> drivers(
      UUID regionId, String status, Boolean online, int limit, int offset) {
    MapSqlParameterSource params = new MapSqlParameterSource();
    return namedJdbcTemplate.query(
        """
        SELECT p.user_id, u.name, u.phone, p.application_status, p.is_online, u.created_at,
               av.plate, av.region_id, av.region_name
        FROM driver_profiles p
        JOIN users u ON u.user_id = p.user_id
        LEFT JOIN LATERAL (
            SELECT v.plate, g.region_id, g.name AS region_name
            FROM vehicles v
            LEFT JOIN vehicle_service_types vst ON vst.vehicle_id = v.vehicle_id
            LEFT JOIN service_types s ON s.service_type_id = vst.service_type_id
            LEFT JOIN regions g ON g.region_id = s.region_id
            WHERE v.driver_user_id = p.user_id AND v.is_active
            ORDER BY g.name NULLS LAST, g.region_id
            LIMIT 1) av ON true
        """
            + driverWhere(regionId, status, online, params)
            + " ORDER BY u.created_at DESC, p.user_id"
            + page(limit, offset, params),
        params,
        (rs, i) ->
            new DriverRow(
                rs.getObject("user_id", UUID.class),
                rs.getString("name"),
                rs.getString("phone"),
                rs.getString("application_status"),
                rs.getBoolean("is_online"),
                rs.getObject("region_id", UUID.class),
                rs.getString("region_name"),
                rs.getString("plate"),
                instant(rs, "created_at")));
  }

  /**
   * The drivers-list count under the same filters.
   *
   * @param regionId see {@link #drivers}
   * @param status see {@link #drivers}
   * @param online see {@link #drivers}
   * @return the count
   */
  public long countDrivers(UUID regionId, String status, Boolean online) {
    MapSqlParameterSource params = new MapSqlParameterSource();
    return namedJdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM driver_profiles p" + driverWhere(regionId, status, online, params),
        params,
        Long.class);
  }

  private static String driverWhere(
      UUID regionId, String status, Boolean online, MapSqlParameterSource params) {
    StringBuilder where = new StringBuilder(" WHERE true");
    if (regionId != null) {
      where.append(" AND ").append(AnalyticsRepository.ACTIVE_VEHICLE_IN_REGION);
      params.addValue("regionId", regionId);
    }
    if (status != null) {
      where.append(" AND p.application_status = :status");
      params.addValue("status", status);
    }
    if (online != null) {
      where.append(" AND p.is_online = :online");
      params.addValue("online", online);
    }
    return where.toString();
  }

  // ---- transactions -----------------------------------------------------------------------------

  /**
   * Wallet transactions and driver ledger entries, newest first (ruling Q5).
   *
   * @param source {@code wallet} / {@code driver_ledger}, or null for both
   * @param type the ledger's own type value, or null
   * @param currency the currency, or null
   * @param userId the wallet owner / the ledger's driver, or null
   * @param from createdAt lower bound (inclusive), or null
   * @param to createdAt upper bound (exclusive), or null
   * @param limit rows
   * @param offset rows skipped
   * @return the rows
   */
  public List<TransactionRow> transactions(
      String source,
      String type,
      String currency,
      UUID userId,
      Instant from,
      Instant to,
      int limit,
      int offset) {
    MapSqlParameterSource params = new MapSqlParameterSource();
    return namedJdbcTemplate.query(
        "SELECT x.*, u.name AS user_name FROM ("
            + transactionUnion(source, type, currency, userId, from, to, params)
            + ") x JOIN users u ON u.user_id = x.user_id ORDER BY x.created_at DESC, x.id"
            + page(limit, offset, params),
        params,
        (rs, i) ->
            new TransactionRow(
                rs.getObject("id", UUID.class),
                rs.getString("source"),
                rs.getObject("user_id", UUID.class),
                rs.getString("user_name"),
                rs.getString("type"),
                rs.getBigDecimal("amount"),
                rs.getString("currency"),
                rs.getObject("ride_id", UUID.class),
                rs.getBigDecimal("balance_after"),
                rs.getString("reason"),
                instant(rs, "created_at")));
  }

  /**
   * The transactions-list count under the same filters.
   *
   * @param source see {@link #transactions}
   * @param type see {@link #transactions}
   * @param currency see {@link #transactions}
   * @param userId see {@link #transactions}
   * @param from see {@link #transactions}
   * @param to see {@link #transactions}
   * @return the count
   */
  public long countTransactions(
      String source, String type, String currency, UUID userId, Instant from, Instant to) {
    MapSqlParameterSource params = new MapSqlParameterSource();
    return namedJdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ("
            + transactionUnion(source, type, currency, userId, from, to, params)
            + ") x",
        params,
        Long.class);
  }

  private static String transactionUnion(
      String source,
      String type,
      String currency,
      UUID userId,
      Instant from,
      Instant to,
      MapSqlParameterSource params) {
    String wallet =
        "SELECT t.wallet_transaction_id AS id, 'wallet' AS source, t.user_id, t.type, t.amount,"
            + " t.currency, t.ride_id, t.balance_after, t.reason, t.created_at"
            + " FROM wallet_transactions t"
            + transactionWhere("t.user_id", type, currency, userId, from, to, params);
    String ledger =
        "SELECT t.driver_ledger_id AS id, 'driver_ledger' AS source, t.driver_user_id AS user_id,"
            + " t.type, t.amount, t.currency, t.ride_id, t.balance_after, NULL AS reason,"
            + " t.created_at FROM driver_ledger t"
            + transactionWhere("t.driver_user_id", type, currency, userId, from, to, params);
    if ("wallet".equals(source)) {
      return wallet;
    }
    if ("driver_ledger".equals(source)) {
      return ledger;
    }
    return wallet + " UNION ALL " + ledger;
  }

  private static String transactionWhere(
      String ownerColumn,
      String type,
      String currency,
      UUID userId,
      Instant from,
      Instant to,
      MapSqlParameterSource params) {
    StringBuilder where = new StringBuilder(" WHERE true");
    if (type != null) {
      where.append(" AND t.type = :type");
      params.addValue("type", type);
    }
    if (currency != null) {
      where.append(" AND t.currency = :currency");
      params.addValue("currency", currency);
    }
    if (userId != null) {
      where.append(" AND ").append(ownerColumn).append(" = :userId");
      params.addValue("userId", userId);
    }
    range(where, "t.created_at", from, to, params);
    return where.toString();
  }

  // ---- shared -----------------------------------------------------------------------------------

  private static void range(
      StringBuilder where, String column, Instant from, Instant to, MapSqlParameterSource params) {
    if (from != null) {
      where.append(" AND ").append(column).append(" >= :from");
      params.addValue("from", OffsetDateTime.ofInstant(from, ZoneOffset.UTC));
    }
    if (to != null) {
      where.append(" AND ").append(column).append(" < :to");
      params.addValue("to", OffsetDateTime.ofInstant(to, ZoneOffset.UTC));
    }
  }

  private static String page(int limit, int offset, MapSqlParameterSource params) {
    params.addValue("limit", limit).addValue("offset", offset);
    return " LIMIT :limit OFFSET :offset";
  }

  private static Instant instant(ResultSet rs, String column) throws SQLException {
    return rs.getObject(column, OffsetDateTime.class).toInstant();
  }
}
