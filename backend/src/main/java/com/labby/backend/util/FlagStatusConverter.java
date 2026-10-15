package com.labby.backend.util;

import com.labby.backend.enums.FlagStatus;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link FlagStatus} to its lowercase DB value. */
@Converter(autoApply = true)
public class FlagStatusConverter implements AttributeConverter<FlagStatus, String> {

  @Override
  public String convertToDatabaseColumn(FlagStatus attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public FlagStatus convertToEntityAttribute(String dbData) {
    return dbData == null ? null : FlagStatus.fromValue(dbData);
  }
}
