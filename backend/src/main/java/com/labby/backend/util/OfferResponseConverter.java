package com.labby.backend.util;

import com.labby.backend.enums.OfferResponse;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link OfferResponse} to its lowercase DB value. */
@Converter(autoApply = true)
public class OfferResponseConverter implements AttributeConverter<OfferResponse, String> {

  @Override
  public String convertToDatabaseColumn(OfferResponse attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public OfferResponse convertToEntityAttribute(String dbData) {
    return dbData == null ? null : OfferResponse.fromValue(dbData);
  }
}
