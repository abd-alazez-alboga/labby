package com.labby.backend.util;

import com.labby.backend.enums.TicketStatus;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link TicketStatus} to its lowercase DB value. */
@Converter(autoApply = true)
public class TicketStatusConverter implements AttributeConverter<TicketStatus, String> {

  @Override
  public String convertToDatabaseColumn(TicketStatus attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public TicketStatus convertToEntityAttribute(String dbData) {
    return dbData == null ? null : TicketStatus.fromValue(dbData);
  }
}
