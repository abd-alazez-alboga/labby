package com.labby.backend.util;

import com.labby.backend.enums.ReferralStatus;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link ReferralStatus} to its lowercase DB value. */
@Converter(autoApply = true)
public class ReferralStatusConverter implements AttributeConverter<ReferralStatus, String> {

  @Override
  public String convertToDatabaseColumn(ReferralStatus attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public ReferralStatus convertToEntityAttribute(String dbData) {
    return dbData == null ? null : ReferralStatus.fromValue(dbData);
  }
}
