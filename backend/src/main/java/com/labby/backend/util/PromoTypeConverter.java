package com.labby.backend.util;

import com.labby.backend.enums.PromoType;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link PromoType} to its lowercase DB value. */
@Converter(autoApply = true)
public class PromoTypeConverter implements AttributeConverter<PromoType, String> {

  @Override
  public String convertToDatabaseColumn(PromoType attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public PromoType convertToEntityAttribute(String dbData) {
    return dbData == null ? null : PromoType.fromValue(dbData);
  }
}
