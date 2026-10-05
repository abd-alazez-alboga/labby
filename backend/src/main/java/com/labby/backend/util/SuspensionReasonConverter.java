package com.labby.backend.util;

import com.labby.backend.enums.SuspensionReason;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link SuspensionReason} to its lowercase DB value. */
@Converter(autoApply = true)
public class SuspensionReasonConverter implements AttributeConverter<SuspensionReason, String> {

  @Override
  public String convertToDatabaseColumn(SuspensionReason attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public SuspensionReason convertToEntityAttribute(String dbData) {
    return dbData == null ? null : SuspensionReason.fromValue(dbData);
  }
}
