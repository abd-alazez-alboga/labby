package com.labby.backend.service;

import com.labby.backend.exception.BusinessRuleViolationException;

/** The CSV export row cap (analytics-v1.yaml, M15 ruling Q4). */
final class ExportLimits {

  private ExportLimits() {}

  /**
   * Refuses an export that would hold more rows than the cap: 422 {@code export_too_large}.
   *
   * @param rows the rows the filter matches
   * @param maxRows the cap
   */
  static void check(long rows, int maxRows) {
    if (rows > maxRows) {
      throw new BusinessRuleViolationException(
              "The export would hold " + rows + " rows; narrow the filters (limit " + maxRows + ")")
          .withCode("export_too_large")
          .withDetail("limit", maxRows)
          .withDetail("rows", rows);
    }
  }
}
