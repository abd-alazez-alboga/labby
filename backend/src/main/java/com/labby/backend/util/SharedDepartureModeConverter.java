package com.labby.backend.util;

import com.labby.backend.enums.SharedDepartureMode;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link SharedDepartureMode} to its lowercase DB value. */
@Converter(autoApply = true)
public class SharedDepartureModeConverter
    implements AttributeConverter<SharedDepartureMode, String> {

  @Override
  public String convertToDatabaseColumn(SharedDepartureMode attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public SharedDepartureMode convertToEntityAttribute(String dbData) {
    return dbData == null ? null : SharedDepartureMode.fromValue(dbData);
  }
}
