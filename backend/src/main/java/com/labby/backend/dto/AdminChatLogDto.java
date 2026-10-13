package com.labby.backend.dto;

import com.labby.backend.enums.ChatWindowState;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The full read-only chat log of a ride for support admins (comms-v1.yaml {@code AdminChatLog},
 * CHAT-03).
 *
 * @param rideId the ride
 * @param windowState the derived window state
 * @param openedAt when the thread opened
 * @param closedAt terminal + 24 h, or null while the ride is live
 * @param items oldest first within the page
 * @param nextCursor the {@code before} cursor of the next-older page; null when exhausted
 */
public record AdminChatLogDto(
    UUID rideId,
    ChatWindowState windowState,
    Instant openedAt,
    Instant closedAt,
    List<ChatMessageDto> items,
    String nextCursor) {}
