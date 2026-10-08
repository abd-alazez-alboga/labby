package com.labby.backend.util;

import com.labby.backend.enums.CancellationReason;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link CancellationReason} to its lowercase DB value. */
@Converter(autoApply = true)
public class CancellationReasonConverter implements AttributeConverter<CancellationReason, String> {

  @Override
  public String convertToDatabaseColumn(CancellationReason attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public CancellationReason convertToEntityAttribute(String dbData) {
    return dbData == null ? null : CancellationReason.fromValue(dbData);
  }
}
