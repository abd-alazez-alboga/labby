package com.labby.backend.util;

import com.labby.backend.enums.RiderDueStatus;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link RiderDueStatus} to its lowercase DB value. */
@Converter(autoApply = true)
public class RiderDueStatusConverter implements AttributeConverter<RiderDueStatus, String> {

  @Override
  public String convertToDatabaseColumn(RiderDueStatus attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public RiderDueStatus convertToEntityAttribute(String dbData) {
    return dbData == null ? null : RiderDueStatus.fromValue(dbData);
  }
}
