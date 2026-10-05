package com.labby.backend.dto;

import java.util.List;

/** A filtered, newest-first page of the audit log (UC-A-04). */
public record AuditLogPageDto(List<AuditLogEntryDto> items, int page, int size, long totalItems) {}
