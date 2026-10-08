package com.labby.backend.util;

import com.labby.backend.enums.PaymentMethod;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link PaymentMethod} to its lowercase DB value. */
@Converter(autoApply = true)
public class PaymentMethodConverter implements AttributeConverter<PaymentMethod, String> {

  @Override
  public String convertToDatabaseColumn(PaymentMethod attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public PaymentMethod convertToEntityAttribute(String dbData) {
    return dbData == null ? null : PaymentMethod.fromValue(dbData);
  }
}
