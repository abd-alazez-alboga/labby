package com.labby.backend.util;

import com.labby.backend.enums.TicketSide;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link TicketSide} to its lowercase DB value. */
@Converter(autoApply = true)
public class TicketSideConverter implements AttributeConverter<TicketSide, String> {

  @Override
  public String convertToDatabaseColumn(TicketSide attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public TicketSide convertToEntityAttribute(String dbData) {
    return dbData == null ? null : TicketSide.fromValue(dbData);
  }
}
