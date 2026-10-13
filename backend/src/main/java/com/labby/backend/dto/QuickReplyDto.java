package com.labby.backend.dto;

/**
 * One localized quick reply (comms-v1.yaml {@code QuickReply}, CHAT-02). Both languages are served;
 * the client renders its own.
 *
 * @param code the catalog code stored on messages
 * @param textEn English text
 * @param textAr Arabic text
 */
public record QuickReplyDto(String code, String textEn, String textAr) {}
