package com.labby.backend.util;

import com.labby.backend.enums.TicketEventType;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link TicketEventType} to its lowercase DB value. */
@Converter(autoApply = true)
public class TicketEventTypeConverter implements AttributeConverter<TicketEventType, String> {

  @Override
  public String convertToDatabaseColumn(TicketEventType attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public TicketEventType convertToEntityAttribute(String dbData) {
    return dbData == null ? null : TicketEventType.fromValue(dbData);
  }
}
