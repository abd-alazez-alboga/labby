package com.labby.backend.util;

import com.labby.backend.enums.ClientType;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link ClientType} to its lowercase DB value. */
@Converter(autoApply = true)
public class ClientTypeConverter implements AttributeConverter<ClientType, String> {

  @Override
  public String convertToDatabaseColumn(ClientType attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public ClientType convertToEntityAttribute(String dbData) {
    return dbData == null ? null : ClientType.fromValue(dbData);
  }
}
