package com.labby.backend.util;

import com.labby.backend.enums.FeedbackCategory;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link FeedbackCategory} to its lowercase DB value. */
@Converter(autoApply = true)
public class FeedbackCategoryConverter implements AttributeConverter<FeedbackCategory, String> {

  @Override
  public String convertToDatabaseColumn(FeedbackCategory attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public FeedbackCategory convertToEntityAttribute(String dbData) {
    return dbData == null ? null : FeedbackCategory.fromValue(dbData);
  }
}
