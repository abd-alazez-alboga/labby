package com.labby.backend.util;

import com.labby.backend.enums.OtpPurpose;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link OtpPurpose} to its lowercase DB value. */
@Converter(autoApply = true)
public class OtpPurposeConverter implements AttributeConverter<OtpPurpose, String> {

  @Override
  public String convertToDatabaseColumn(OtpPurpose attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public OtpPurpose convertToEntityAttribute(String dbData) {
    return dbData == null ? null : OtpPurpose.fromValue(dbData);
  }
}
