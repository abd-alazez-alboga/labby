package com.labby.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.labby.backend.enums.ChatMessageKind;
import com.labby.backend.enums.RideParty;
import java.time.Instant;
import java.util.UUID;

/**
 * One chat message (comms-v1.yaml {@code ChatMessage}).
 *
 * @param messageId the stored id
 * @param clientMsgId the sender's dedup key — echoed only to its sender, absent otherwise
 * @param senderRole rider or driver
 * @param kind text or quick_reply
 * @param body the text (text messages only)
 * @param quickReply the localized quick reply (quick replies only)
 * @param sentAt when the message was stored
 */
public record ChatMessageDto(
    UUID messageId,
    @JsonInclude(JsonInclude.Include.NON_NULL) UUID clientMsgId,
    RideParty senderRole,
    ChatMessageKind kind,
    String body,
    QuickReplyDto quickReply,
    Instant sentAt) {}
