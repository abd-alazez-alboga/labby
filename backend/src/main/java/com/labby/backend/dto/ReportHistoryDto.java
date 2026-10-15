package com.labby.backend.dto;

/**
 * A party's trust history in one role (UC-A-17 step 2).
 *
 * @param reportsAgainst reports filed against the user in that role
 * @param substantiatedAgainst of those, substantiated
 * @param reportsFiled reports the user filed in that role
 */
public record ReportHistoryDto(long reportsAgainst, long substantiatedAgainst, long reportsFiled) {}
