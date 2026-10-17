package com.labby.backend.util;

import com.labby.backend.enums.ChallengeGoalType;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link ChallengeGoalType} to its lowercase DB value. */
@Converter(autoApply = true)
public class ChallengeGoalTypeConverter implements AttributeConverter<ChallengeGoalType, String> {

  @Override
  public String convertToDatabaseColumn(ChallengeGoalType attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public ChallengeGoalType convertToEntityAttribute(String dbData) {
    return dbData == null ? null : ChallengeGoalType.fromValue(dbData);
  }
}
