package com.labby.backend.util;

import com.labby.backend.enums.AccountState;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link AccountState} to its lowercase DB value. */
@Converter(autoApply = true)
public class AccountStateConverter implements AttributeConverter<AccountState, String> {

  @Override
  public String convertToDatabaseColumn(AccountState attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public AccountState convertToEntityAttribute(String dbData) {
    return dbData == null ? null : AccountState.fromValue(dbData);
  }
}
