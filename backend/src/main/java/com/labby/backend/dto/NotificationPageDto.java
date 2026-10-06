package com.labby.backend.dto;

import java.util.List;

/**
 * One page of a client's notification center, newest first (realtime-v1.yaml {@code
 * NotificationPage}).
 *
 * @param items the entries
 * @param unread the unread count of this client's center
 * @param nextCursor the cursor of the next page ({@code before}); null on the last page
 */
public record NotificationPageDto(List<NotificationDto> items, long unread, String nextCursor) {}
