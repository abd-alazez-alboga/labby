package com.labby.backend.util;

import com.labby.backend.enums.FlagKind;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link FlagKind} to its lowercase DB value. */
@Converter(autoApply = true)
public class FlagKindConverter implements AttributeConverter<FlagKind, String> {

  @Override
  public String convertToDatabaseColumn(FlagKind attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public FlagKind convertToEntityAttribute(String dbData) {
    return dbData == null ? null : FlagKind.fromValue(dbData);
  }
}
