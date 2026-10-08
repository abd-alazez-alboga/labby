package com.labby.backend.util;

import com.labby.backend.enums.ComfortConversation;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link ComfortConversation} to its lowercase DB value. */
@Converter(autoApply = true)
public class ComfortConversationConverter
    implements AttributeConverter<ComfortConversation, String> {

  @Override
  public String convertToDatabaseColumn(ComfortConversation attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public ComfortConversation convertToEntityAttribute(String dbData) {
    return dbData == null ? null : ComfortConversation.fromValue(dbData);
  }
}
