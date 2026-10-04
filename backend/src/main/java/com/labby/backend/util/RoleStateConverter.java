package com.labby.backend.util;

import com.labby.backend.enums.RoleState;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link RoleState} to its lowercase DB value. */
@Converter(autoApply = true)
public class RoleStateConverter implements AttributeConverter<RoleState, String> {

  @Override
  public String convertToDatabaseColumn(RoleState attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public RoleState convertToEntityAttribute(String dbData) {
    return dbData == null ? null : RoleState.fromValue(dbData);
  }
}
