package com.labby.backend.util;

import com.labby.backend.enums.RideParty;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link RideParty} to its lowercase DB value. */
@Converter(autoApply = true)
public class RidePartyConverter implements AttributeConverter<RideParty, String> {

  @Override
  public String convertToDatabaseColumn(RideParty attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public RideParty convertToEntityAttribute(String dbData) {
    return dbData == null ? null : RideParty.fromValue(dbData);
  }
}
