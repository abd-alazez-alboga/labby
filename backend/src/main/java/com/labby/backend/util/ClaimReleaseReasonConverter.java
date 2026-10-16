package com.labby.backend.util;

import com.labby.backend.enums.ClaimReleaseReason;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link ClaimReleaseReason} to its lowercase DB value. */
@Converter(autoApply = true)
public class ClaimReleaseReasonConverter implements AttributeConverter<ClaimReleaseReason, String> {

  @Override
  public String convertToDatabaseColumn(ClaimReleaseReason attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public ClaimReleaseReason convertToEntityAttribute(String dbData) {
    return dbData == null ? null : ClaimReleaseReason.fromValue(dbData);
  }
}
