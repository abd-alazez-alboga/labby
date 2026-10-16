package com.labby.backend.dto;

import com.labby.backend.enums.PaymentMethod;
import com.labby.backend.enums.PaymentStatus;
import com.labby.backend.enums.SharedMemberStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * One shared-ride party (scheduled-shared-v1 MemberView). {@code firstName} is set in the driver
 * view only — riders never see other members.
 */
public record MemberViewDto(
    UUID memberId,
    String firstName,
    boolean isCreator,
    int partySize,
    SharedMemberStatus status,
    PaymentMethod paymentMethod,
    Instant joinedAt,
    BigDecimal cancellationFee,
    BigDecimal shareAmount,
    PaymentStatus paymentStatus,
    BigDecimal walletApplied,
    BigDecimal cashDue) {}
