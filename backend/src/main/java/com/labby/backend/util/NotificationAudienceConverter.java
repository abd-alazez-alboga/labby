package com.labby.backend.util;

import com.labby.backend.enums.NotificationAudience;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link NotificationAudience} to its lowercase DB value. */
@Converter(autoApply = true)
public class NotificationAudienceConverter
    implements AttributeConverter<NotificationAudience, String> {

  @Override
  public String convertToDatabaseColumn(NotificationAudience attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public NotificationAudience convertToEntityAttribute(String dbData) {
    return dbData == null ? null : NotificationAudience.fromValue(dbData);
  }
}
