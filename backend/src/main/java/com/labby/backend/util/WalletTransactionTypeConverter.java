package com.labby.backend.util;

import com.labby.backend.enums.WalletTransactionType;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps {@link WalletTransactionType} to its lowercase DB value. */
@Converter(autoApply = true)
public class WalletTransactionTypeConverter
    implements AttributeConverter<WalletTransactionType, String> {

  @Override
  public String convertToDatabaseColumn(WalletTransactionType attribute) {
    return attribute == null ? null : attribute.getValue();
  }

  @Override
  public WalletTransactionType convertToEntityAttribute(String dbData) {
    return dbData == null ? null : WalletTransactionType.fromValue(dbData);
  }
}
