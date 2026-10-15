package com.labby.backend.dto;

import com.labby.backend.enums.RideParty;
import java.util.UUID;

/** A user in one role, as admins see it on the trust queues. */
public record PartySummaryDto(UUID userId, String name, RideParty role) {}
