package com.labby.backend.dto;

import com.labby.backend.enums.RideParty;

/**
 * The other party of a chat thread (comms-v1.yaml {@code ChatThread.counterpart}).
 *
 * @param role rider or driver
 * @param firstName the counterpart's first name
 * @param photoUrl a fresh expiring photo url (drivers only), or null
 * @param phone the real phone number (CALL-01) — non-null only while writes are allowed
 */
public record ChatCounterpartDto(RideParty role, String firstName, String photoUrl, String phone) {}
