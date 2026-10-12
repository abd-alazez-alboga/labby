package com.labby.backend.util;

import com.labby.backend.enums.SettlementDirection;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link SettlementDirection} to its lowercase DB value. */
@Converter(autoApply = true)
public class SettlementDirectionConverter
    implements AttributeConverter<SettlementDirection, String> {

  @Override
  public String convertToDatabaseColumn(SettlementDirection attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public SettlementDirection convertToEntityAttribute(String dbData) {
    return dbData == null ? null : SettlementDirection.fromValue(dbData);
  }
}
