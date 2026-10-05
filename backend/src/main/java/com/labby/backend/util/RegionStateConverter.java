package com.labby.backend.util;

import com.labby.backend.enums.RegionState;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link RegionState} to its lowercase DB value. */
@Converter(autoApply = true)
public class RegionStateConverter implements AttributeConverter<RegionState, String> {

  @Override
  public String convertToDatabaseColumn(RegionState attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public RegionState convertToEntityAttribute(String dbData) {
    return dbData == null ? null : RegionState.fromValue(dbData);
  }
}
