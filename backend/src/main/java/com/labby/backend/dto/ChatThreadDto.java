package com.labby.backend.dto;

import com.labby.backend.enums.ChatWindowState;
import java.time.Instant;
import java.util.UUID;

/**
 * The ride's chat thread as a party sees it (comms-v1.yaml {@code ChatThread}, UC-S-13/14).
 *
 * @param rideId the ride
 * @param windowState the derived window state (CHAT-01)
 * @param openedAt when the thread opened (acceptance)
 * @param closedAt terminal + 24 h, or null while the ride is live
 * @param unreadCount counterpart messages after the caller's read marker
 * @param lastReadMessageId the caller's own marker, or null
 * @param counterpartLastReadMessageId the counterpart's marker, or null
 * @param counterpart the other party
 */
public record ChatThreadDto(
    UUID rideId,
    ChatWindowState windowState,
    Instant openedAt,
    Instant closedAt,
    long unreadCount,
    UUID lastReadMessageId,
    UUID counterpartLastReadMessageId,
    ChatCounterpartDto counterpart) {}
