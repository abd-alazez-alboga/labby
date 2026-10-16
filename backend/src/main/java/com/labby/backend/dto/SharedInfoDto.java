package com.labby.backend.dto;

import com.labby.backend.enums.SharedDispatchTrigger;
import java.time.Instant;
import java.util.List;

/**
 * The shared extension on a ride of kind {@code shared} (scheduled-shared-v1 SharedInfo): {@code
 * me} in rider views, {@code members} (every party) in the driver view only.
 */
public record SharedInfoDto(
    int totalSeats,
    int seatsTaken,
    DepartureDto departure,
    SharedDispatchTrigger dispatchTrigger,
    Instant dispatchedAt,
    boolean isCreator,
    MemberViewDto me,
    List<MemberViewDto> members,
    SplitSummaryDto split) {}
