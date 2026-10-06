package com.labby.backend.dto;

/**
 * The badge count of a client's notification center.
 *
 * @param unread unread entries
 */
public record UnreadCountDto(long unread) {}
