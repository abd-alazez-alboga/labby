package com.labby.backend.util;

import com.labby.backend.enums.PointsTransactionType;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link PointsTransactionType} to its lowercase DB value. */
@Converter(autoApply = true)
public class PointsTransactionTypeConverter
    implements AttributeConverter<PointsTransactionType, String> {

  @Override
  public String convertToDatabaseColumn(PointsTransactionType attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public PointsTransactionType convertToEntityAttribute(String dbData) {
    return dbData == null ? null : PointsTransactionType.fromValue(dbData);
  }
}
