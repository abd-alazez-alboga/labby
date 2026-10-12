package com.labby.backend.util;

import com.labby.backend.enums.DriverLedgerType;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link DriverLedgerType} to its lowercase DB value. */
@Converter(autoApply = true)
public class DriverLedgerTypeConverter implements AttributeConverter<DriverLedgerType, String> {

  @Override
  public String convertToDatabaseColumn(DriverLedgerType attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public DriverLedgerType convertToEntityAttribute(String dbData) {
    return dbData == null ? null : DriverLedgerType.fromValue(dbData);
  }
}
