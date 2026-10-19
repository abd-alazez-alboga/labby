package com.labby.backend.util;

import com.labby.backend.enums.TicketKind;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link TicketKind} to its lowercase DB value. */
@Converter(autoApply = true)
public class TicketKindConverter implements AttributeConverter<TicketKind, String> {

  @Override
  public String convertToDatabaseColumn(TicketKind attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public TicketKind convertToEntityAttribute(String dbData) {
    return dbData == null ? null : TicketKind.fromValue(dbData);
  }
}
