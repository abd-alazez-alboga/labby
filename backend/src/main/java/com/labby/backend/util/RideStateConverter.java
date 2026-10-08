package com.labby.backend.util;

import com.labby.backend.enums.RideState;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link RideState} to its lowercase DB value. */
@Converter(autoApply = true)
public class RideStateConverter implements AttributeConverter<RideState, String> {

  @Override
  public String convertToDatabaseColumn(RideState attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public RideState convertToEntityAttribute(String dbData) {
    return dbData == null ? null : RideState.fromValue(dbData);
  }
}
