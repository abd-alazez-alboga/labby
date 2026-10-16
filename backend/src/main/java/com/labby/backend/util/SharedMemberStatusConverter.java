package com.labby.backend.util;

import com.labby.backend.enums.SharedMemberStatus;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link SharedMemberStatus} to its lowercase DB value. */
@Converter(autoApply = true)
public class SharedMemberStatusConverter implements AttributeConverter<SharedMemberStatus, String> {

  @Override
  public String convertToDatabaseColumn(SharedMemberStatus attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public SharedMemberStatus convertToEntityAttribute(String dbData) {
    return dbData == null ? null : SharedMemberStatus.fromValue(dbData);
  }
}
