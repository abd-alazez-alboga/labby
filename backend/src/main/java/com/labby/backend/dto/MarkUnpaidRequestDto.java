package com.labby.backend.dto;

import jakarta.validation.constraints.Size;

/** Optional note when the rider did not pay (UC-D-09 E1). */
public record MarkUnpaidRequestDto(@Size(max = 500) String note) {}
