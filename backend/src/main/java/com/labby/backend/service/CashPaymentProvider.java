package com.labby.backend.service;

import com.labby.backend.enums.PaymentMethod;
import java.math.BigDecimal;
import org.springframework.stereotype.Service;

/**
 * {@link PaymentProvider} for the {@code cash} method: the rider pays the driver in person, so
 * nothing is collected on-platform. The driver confirms the cash later (cash-confirm, or
 * mark-unpaid), which the money engine settles.
 */
@Service
public class CashPaymentProvider implements PaymentProvider {

  @Override
  public PaymentMethod method() {
    return PaymentMethod.CASH;
  }

  @Override
  public BigDecimal collectUpTo(PaymentRequest request) {
    return BigDecimal.ZERO;
  }

  @Override
  public boolean collectInFull(PaymentRequest request) {
    return false;
  }
}
