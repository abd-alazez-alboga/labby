package com.labby.backend.util;

import com.labby.backend.enums.CaseStatus;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link CaseStatus} to its lowercase DB value. */
@Converter(autoApply = true)
public class CaseStatusConverter implements AttributeConverter<CaseStatus, String> {

  @Override
  public String convertToDatabaseColumn(CaseStatus attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public CaseStatus convertToEntityAttribute(String dbData) {
    return dbData == null ? null : CaseStatus.fromValue(dbData);
  }
}
