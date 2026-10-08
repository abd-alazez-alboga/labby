package com.labby.backend.util;

import com.labby.backend.enums.PaymentStatus;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link PaymentStatus} to its lowercase DB value. */
@Converter(autoApply = true)
public class PaymentStatusConverter implements AttributeConverter<PaymentStatus, String> {

  @Override
  public String convertToDatabaseColumn(PaymentStatus attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public PaymentStatus convertToEntityAttribute(String dbData) {
    return dbData == null ? null : PaymentStatus.fromValue(dbData);
  }
}
