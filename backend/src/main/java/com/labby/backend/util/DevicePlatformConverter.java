package com.labby.backend.util;

import com.labby.backend.enums.DevicePlatform;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link DevicePlatform} to its lowercase DB value. */
@Converter(autoApply = true)
public class DevicePlatformConverter implements AttributeConverter<DevicePlatform, String> {

  @Override
  public String convertToDatabaseColumn(DevicePlatform attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public DevicePlatform convertToEntityAttribute(String dbData) {
    return dbData == null ? null : DevicePlatform.fromValue(dbData);
  }
}
