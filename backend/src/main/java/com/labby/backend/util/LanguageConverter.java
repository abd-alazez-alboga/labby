package com.labby.backend.util;

import com.labby.backend.enums.Language;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link Language} to its lowercase DB value. */
@Converter(autoApply = true)
public class LanguageConverter implements AttributeConverter<Language, String> {

  @Override
  public String convertToDatabaseColumn(Language attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public Language convertToEntityAttribute(String dbData) {
    return dbData == null ? null : Language.fromValue(dbData);
  }
}
