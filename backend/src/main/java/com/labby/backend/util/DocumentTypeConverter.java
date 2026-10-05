package com.labby.backend.util;

import com.labby.backend.enums.DocumentType;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link DocumentType} to its lowercase DB value. */
@Converter(autoApply = true)
public class DocumentTypeConverter implements AttributeConverter<DocumentType, String> {

  @Override
  public String convertToDatabaseColumn(DocumentType attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public DocumentType convertToEntityAttribute(String dbData) {
    return dbData == null ? null : DocumentType.fromValue(dbData);
  }
}
