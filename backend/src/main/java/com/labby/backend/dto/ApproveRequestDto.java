package com.labby.backend.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.UUID;

/**
 * Approval of an application or vehicle switch with the assigned service types (DRV-03).
 *
 * @param serviceTypeIds distinct ids from /admin/assignable-service-types
 */
public record ApproveRequestDto(@NotEmpty List<@NotNull UUID> serviceTypeIds) {}
