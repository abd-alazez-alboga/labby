package com.labby.backend.util;

import com.labby.backend.enums.NotificationCategory;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link NotificationCategory} to its lowercase DB value. */
@Converter(autoApply = true)
public class NotificationCategoryConverter
    implements AttributeConverter<NotificationCategory, String> {

  @Override
  public String convertToDatabaseColumn(NotificationCategory attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public NotificationCategory convertToEntityAttribute(String dbData) {
    return dbData == null ? null : NotificationCategory.fromValue(dbData);
  }
}
