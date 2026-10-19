package com.labby.backend.util;

import com.labby.backend.enums.ArticleStatus;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link ArticleStatus} to its lowercase DB value. */
@Converter(autoApply = true)
public class ArticleStatusConverter implements AttributeConverter<ArticleStatus, String> {

  @Override
  public String convertToDatabaseColumn(ArticleStatus attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public ArticleStatus convertToEntityAttribute(String dbData) {
    return dbData == null ? null : ArticleStatus.fromValue(dbData);
  }
}
