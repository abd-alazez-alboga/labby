package com.labby.backend.dto;

import java.util.List;

/**
 * One chat history page (comms-v1.yaml {@code ChatMessagePage}).
 *
 * @param items oldest first within the page
 * @param nextCursor the {@code before} cursor of the next-older page; null when exhausted
 */
public record ChatMessagePageDto(List<ChatMessageDto> items, String nextCursor) {}
