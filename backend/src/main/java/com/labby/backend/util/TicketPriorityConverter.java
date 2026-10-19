package com.labby.backend.util;

import com.labby.backend.enums.TicketPriority;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link TicketPriority} to its lowercase DB value. */
@Converter(autoApply = true)
public class TicketPriorityConverter implements AttributeConverter<TicketPriority, String> {

  @Override
  public String convertToDatabaseColumn(TicketPriority attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public TicketPriority convertToEntityAttribute(String dbData) {
    return dbData == null ? null : TicketPriority.fromValue(dbData);
  }
}
