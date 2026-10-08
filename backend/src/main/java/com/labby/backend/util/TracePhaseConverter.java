package com.labby.backend.util;

import com.labby.backend.enums.TracePhase;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link TracePhase} to its lowercase DB value. */
@Converter(autoApply = true)
public class TracePhaseConverter implements AttributeConverter<TracePhase, String> {

  @Override
  public String convertToDatabaseColumn(TracePhase attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public TracePhase convertToEntityAttribute(String dbData) {
    return dbData == null ? null : TracePhase.fromValue(dbData);
  }
}
