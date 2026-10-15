package com.labby.backend.dto;

import java.util.List;

/** One page of the caller's filed reports, newest first. */
public record OwnReportPageDto(List<OwnReportDto> items, int page, int size, long totalElements) {}
