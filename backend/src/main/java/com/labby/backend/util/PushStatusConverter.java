package com.labby.backend.util;

import com.labby.backend.enums.PushStatus;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link PushStatus} to its lowercase DB value. */
@Converter(autoApply = true)
public class PushStatusConverter implements AttributeConverter<PushStatus, String> {

  @Override
  public String convertToDatabaseColumn(PushStatus attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public PushStatus convertToEntityAttribute(String dbData) {
    return dbData == null ? null : PushStatus.fromValue(dbData);
  }
}
