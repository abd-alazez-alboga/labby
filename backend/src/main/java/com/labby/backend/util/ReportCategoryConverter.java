package com.labby.backend.util;

import com.labby.backend.enums.ReportCategory;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link ReportCategory} to its lowercase DB value. */
@Converter(autoApply = true)
public class ReportCategoryConverter implements AttributeConverter<ReportCategory, String> {

  @Override
  public String convertToDatabaseColumn(ReportCategory attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public ReportCategory convertToEntityAttribute(String dbData) {
    return dbData == null ? null : ReportCategory.fromValue(dbData);
  }
}
