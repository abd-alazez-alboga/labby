package com.labby.backend.util;

import com.labby.backend.enums.PickupDistanceMode;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link PickupDistanceMode} to its lowercase DB value. */
@Converter(autoApply = true)
public class PickupDistanceModeConverter implements AttributeConverter<PickupDistanceMode, String> {

  @Override
  public String convertToDatabaseColumn(PickupDistanceMode attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public PickupDistanceMode convertToEntityAttribute(String dbData) {
    return dbData == null ? null : PickupDistanceMode.fromValue(dbData);
  }
}
