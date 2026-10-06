package com.labby.backend.dto;

import com.labby.backend.enums.CannotGoOnlineReason;
import com.labby.backend.enums.SuspensionReason;
import java.time.Instant;

/**
 * A driver's online state and whether they may go online (realtime-v1.yaml {@code
 * DriverAvailability}, DRV-05, UC-D-04).
 *
 * @param online whether the driver is online
 * @param onlineSince when the driver went online; null while offline
 * @param canGoOnline whether every gate passes
 * @param cannotGoOnlineReason the first failing gate when {@code canGoOnline} is false
 * @param suspensionReason the driver role's suspension reason when {@code role_suspended}
 * @param offersBlockedReason online but no offers (M8 balance floor); always null before M8
 * @param streamHealthy while online: a sample arrived within {@code staleAfterSeconds}; null
 *     offline
 * @param streamIntervalSeconds send a sample this often
 * @param staleAfterSeconds silence longer than this makes the driver stale
 */
public record DriverAvailabilityDto(
    boolean online,
    Instant onlineSince,
    boolean canGoOnline,
    CannotGoOnlineReason cannotGoOnlineReason,
    SuspensionReason suspensionReason,
    String offersBlockedReason,
    Boolean streamHealthy,
    int streamIntervalSeconds,
    int staleAfterSeconds) {}
