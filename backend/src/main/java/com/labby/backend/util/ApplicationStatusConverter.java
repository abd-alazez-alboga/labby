package com.labby.backend.util;

import com.labby.backend.enums.ApplicationStatus;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link ApplicationStatus} to its lowercase DB value. */
@Converter(autoApply = true)
public class ApplicationStatusConverter implements AttributeConverter<ApplicationStatus, String> {

  @Override
  public String convertToDatabaseColumn(ApplicationStatus attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public ApplicationStatus convertToEntityAttribute(String dbData) {
    return dbData == null ? null : ApplicationStatus.fromValue(dbData);
  }
}
