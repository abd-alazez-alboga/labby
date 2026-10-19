package com.labby.backend.dto;

import java.util.List;

/** One page of the admin users list. */
public record AdminUserPageDto(List<AdminUserDto> items, int page, int size, long totalItems) {}
