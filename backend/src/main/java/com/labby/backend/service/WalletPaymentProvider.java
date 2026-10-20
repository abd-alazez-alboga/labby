package com.labby.backend.service;

import com.labby.backend.enums.PaymentMethod;
import com.labby.backend.enums.WalletTransactionType;
import java.math.BigDecimal;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * {@link PaymentProvider} for the {@code wallet} method (PAY-01/02): debits the payer's
 * earned-credit wallet in the ride's currency through {@link WalletService}, which locks the
 * balance row and writes the {@code fare_payment} / {@code cancellation_fee} ledger entry.
 */
@Service
@RequiredArgsConstructor
public class WalletPaymentProvider implements PaymentProvider {

  private final WalletService walletService;

  @Override
  public PaymentMethod method() {
    return PaymentMethod.WALLET;
  }

  @Override
  public BigDecimal collectUpTo(PaymentRequest request) {
    if (request.amount().signum() <= 0) {
      return BigDecimal.ZERO; // V1 audit C2: a zero fare (full promo) collects nothing
    }
    return walletService.debitUpTo(
        request.payerUserId(),
        request.currency(),
        request.amount(),
        transactionType(request.charge()),
        request.rideId());
  }

  @Override
  public boolean collectInFull(PaymentRequest request) {
    return walletService
        .debitIfCovered(
            request.payerUserId(),
            request.currency(),
            request.amount(),
            transactionType(request.charge()),
            request.rideId())
        .isPresent();
  }

  private static WalletTransactionType transactionType(Charge charge) {
    return switch (charge) {
      case FARE -> WalletTransactionType.FARE_PAYMENT;
      case CANCELLATION_FEE -> WalletTransactionType.CANCELLATION_FEE;
    };
  }
}
