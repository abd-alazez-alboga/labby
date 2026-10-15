package com.labby.backend.util;

import com.labby.backend.enums.DriverMetric;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link DriverMetric} to its lowercase DB value. */
@Converter(autoApply = true)
public class DriverMetricConverter implements AttributeConverter<DriverMetric, String> {

  @Override
  public String convertToDatabaseColumn(DriverMetric attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public DriverMetric convertToEntityAttribute(String dbData) {
    return dbData == null ? null : DriverMetric.fromValue(dbData);
  }
}
