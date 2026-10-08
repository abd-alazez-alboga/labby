package com.labby.backend.util;

import com.labby.backend.enums.ComfortTemperature;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link ComfortTemperature} to its lowercase DB value. */
@Converter(autoApply = true)
public class ComfortTemperatureConverter implements AttributeConverter<ComfortTemperature, String> {

  @Override
  public String convertToDatabaseColumn(ComfortTemperature attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public ComfortTemperature convertToEntityAttribute(String dbData) {
    return dbData == null ? null : ComfortTemperature.fromValue(dbData);
  }
}
