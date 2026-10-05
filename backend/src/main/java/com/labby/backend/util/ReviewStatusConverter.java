package com.labby.backend.util;

import com.labby.backend.enums.ReviewStatus;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link ReviewStatus} to its lowercase DB value. */
@Converter(autoApply = true)
public class ReviewStatusConverter implements AttributeConverter<ReviewStatus, String> {

  @Override
  public String convertToDatabaseColumn(ReviewStatus attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public ReviewStatus convertToEntityAttribute(String dbData) {
    return dbData == null ? null : ReviewStatus.fromValue(dbData);
  }
}
