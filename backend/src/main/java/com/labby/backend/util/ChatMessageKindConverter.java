package com.labby.backend.util;

import com.labby.backend.enums.ChatMessageKind;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link ChatMessageKind} to its lowercase DB value. */
@Converter(autoApply = true)
public class ChatMessageKindConverter implements AttributeConverter<ChatMessageKind, String> {

  @Override
  public String convertToDatabaseColumn(ChatMessageKind attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public ChatMessageKind convertToEntityAttribute(String dbData) {
    return dbData == null ? null : ChatMessageKind.fromValue(dbData);
  }
}
