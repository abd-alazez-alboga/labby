package com.labby.backend.service;

import com.labby.backend.dto.CsvFileDto;
import java.util.UUID;

/**
 * CSV export of the five key admin lists (ADM-06, UC-A-31; analytics-v1.yaml). Each export takes
 * its list's own filter, holds exactly the list's rows in the list's order (at most the configured
 * cap, 422 {@code export_too_large} above), runs under the analytics statement time limit, and is
 * audit-logged as {@code export.<list>} with the filters and the row count.
 */
public interface AdminExportService {

  /**
   * The rides list.
   *
   * @param adminUserId the exporting admin
   * @param filter the rides-list filter
   * @return the file
   */
  CsvFileDto rides(UUID adminUserId, AdminRideService.Filter filter);

  /**
   * The users list.
   *
   * @param adminUserId the exporting admin
   * @param filter the users-list filter
   * @param contactAccess whether the phone column is filled ({@code support:handle})
   * @return the file
   */
  CsvFileDto users(
      UUID adminUserId, AdminDirectoryService.UserFilter filter, boolean contactAccess);

  /**
   * The drivers list.
   *
   * @param adminUserId the exporting admin
   * @param filter the drivers-list filter
   * @param contactAccess whether the phone column is filled ({@code support:handle})
   * @return the file
   */
  CsvFileDto drivers(
      UUID adminUserId, AdminDirectoryService.DriverFilter filter, boolean contactAccess);

  /**
   * The transactions list.
   *
   * @param adminUserId the exporting admin
   * @param filter the transactions-list filter
   * @return the file
   */
  CsvFileDto transactions(UUID adminUserId, AdminDirectoryService.TransactionFilter filter);

  /**
   * The ticket queue.
   *
   * @param adminUserId the exporting admin
   * @param filter the queue filter
   * @return the file
   */
  CsvFileDto tickets(UUID adminUserId, SupportTicketService.AdminTicketFilter filter);
}
