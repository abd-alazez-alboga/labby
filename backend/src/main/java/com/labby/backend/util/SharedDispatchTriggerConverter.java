package com.labby.backend.util;

import com.labby.backend.enums.SharedDispatchTrigger;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link SharedDispatchTrigger} to its lowercase DB value. */
@Converter(autoApply = true)
public class SharedDispatchTriggerConverter
    implements AttributeConverter<SharedDispatchTrigger, String> {

  @Override
  public String convertToDatabaseColumn(SharedDispatchTrigger attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public SharedDispatchTrigger convertToEntityAttribute(String dbData) {
    return dbData == null ? null : SharedDispatchTrigger.fromValue(dbData);
  }
}
