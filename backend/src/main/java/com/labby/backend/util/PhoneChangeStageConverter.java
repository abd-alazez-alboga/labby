package com.labby.backend.util;

import com.labby.backend.enums.PhoneChangeStage;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link PhoneChangeStage} to its lowercase DB value. */
@Converter(autoApply = true)
public class PhoneChangeStageConverter implements AttributeConverter<PhoneChangeStage, String> {

  @Override
  public String convertToDatabaseColumn(PhoneChangeStage attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public PhoneChangeStage convertToEntityAttribute(String dbData) {
    return dbData == null ? null : PhoneChangeStage.fromValue(dbData);
  }
}
