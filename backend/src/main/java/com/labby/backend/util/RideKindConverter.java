package com.labby.backend.util;

import com.labby.backend.enums.RideKind;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link RideKind} to its lowercase DB value. */
@Converter(autoApply = true)
public class RideKindConverter implements AttributeConverter<RideKind, String> {

  @Override
  public String convertToDatabaseColumn(RideKind attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public RideKind convertToEntityAttribute(String dbData) {
    return dbData == null ? null : RideKind.fromValue(dbData);
  }
}
