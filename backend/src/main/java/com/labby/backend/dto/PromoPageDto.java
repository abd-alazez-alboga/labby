package com.labby.backend.dto;

import java.util.List;

/** One admin page of promos, newest first. */
public record PromoPageDto(List<PromoDto> items, int page, int size, long totalItems) {}
