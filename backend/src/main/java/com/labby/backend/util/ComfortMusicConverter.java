package com.labby.backend.util;

import com.labby.backend.enums.ComfortMusic;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link ComfortMusic} to its lowercase DB value. */
@Converter(autoApply = true)
public class ComfortMusicConverter implements AttributeConverter<ComfortMusic, String> {

  @Override
  public String convertToDatabaseColumn(ComfortMusic attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public ComfortMusic convertToEntityAttribute(String dbData) {
    return dbData == null ? null : ComfortMusic.fromValue(dbData);
  }
}
