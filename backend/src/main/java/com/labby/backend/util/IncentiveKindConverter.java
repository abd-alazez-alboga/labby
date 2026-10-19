package com.labby.backend.util;

import com.labby.backend.enums.IncentiveKind;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link IncentiveKind} to its lowercase DB value. */
@Converter(autoApply = true)
public class IncentiveKindConverter implements AttributeConverter<IncentiveKind, String> {

  @Override
  public String convertToDatabaseColumn(IncentiveKind attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public IncentiveKind convertToEntityAttribute(String dbData) {
    return dbData == null ? null : IncentiveKind.fromValue(dbData);
  }
}
