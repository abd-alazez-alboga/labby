package com.labby.backend.util;

import com.labby.backend.enums.Role;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link Role} to its lowercase DB value. */
@Converter(autoApply = true)
public class RoleConverter implements AttributeConverter<Role, String> {

  @Override
  public String convertToDatabaseColumn(Role attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public Role convertToEntityAttribute(String dbData) {
    return dbData == null ? null : Role.fromValue(dbData);
  }
}
