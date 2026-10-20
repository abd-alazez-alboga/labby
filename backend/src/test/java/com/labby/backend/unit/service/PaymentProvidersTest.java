package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.labby.backend.enums.PaymentMethod;
import com.labby.backend.enums.WalletTransactionType;
import com.labby.backend.model.WalletTransaction;
import com.labby.backend.service.CashPaymentProvider;
import com.labby.backend.service.PaymentProvider;
import com.labby.backend.service.PaymentProvider.Charge;
import com.labby.backend.service.PaymentProvider.PaymentRequest;
import com.labby.backend.service.PaymentProviders;
import com.labby.backend.service.WalletPaymentProvider;
import com.labby.backend.service.WalletService;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** The ride-payment seam (ES-06, NFR-M1): one provider per method, V1 cash + wallet behaviour. */
@ExtendWith(MockitoExtension.class)
class PaymentProvidersTest {

  private static final UUID RIDER = UUID.randomUUID();
  private static final UUID RIDE = UUID.randomUUID();
  private static final BigDecimal AMOUNT = new BigDecimal("12000.00");

  @Mock private WalletService walletService;

  private WalletPaymentProvider wallet;
  private CashPaymentProvider cash;

  @BeforeEach
  void setUp() {
    wallet = new WalletPaymentProvider(walletService);
    cash = new CashPaymentProvider();
  }

  private static PaymentRequest request(Charge charge) {
    return new PaymentRequest(RIDER, "SYP", AMOUNT, charge, RIDE);
  }

  @Test
  @DisplayName("selects the provider of each payment method")
  void shouldSelectProviderByMethod() {
    PaymentProviders providers = new PaymentProviders(List.of(cash, wallet));

    assertThat(providers.forMethod(PaymentMethod.CASH)).isSameAs(cash);
    assertThat(providers.forMethod(PaymentMethod.WALLET)).isSameAs(wallet);
  }

  @Test
  @DisplayName("fails fast when a method has no provider, or two")
  void shouldFailWhenProvidersIncompleteOrDuplicated() {
    assertThatThrownBy(() -> new PaymentProviders(List.of(cash)))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("WALLET");
    assertThatThrownBy(() -> new PaymentProviders(List.of(cash, wallet, new CashPaymentProvider())))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("CASH");
  }

  @Test
  @DisplayName("wallet: a fare debits what the wallet covers as a fare_payment")
  void shouldDebitUpToAmountWhenWalletCollectsFare() {
    when(walletService.debitUpTo(RIDER, "SYP", AMOUNT, WalletTransactionType.FARE_PAYMENT, RIDE))
        .thenReturn(new BigDecimal("5000.00"));

    assertThat(wallet.collectUpTo(request(Charge.FARE))).isEqualByComparingTo("5000.00");
  }

  @Test
  @DisplayName("wallet: a carried due is collected in full or not at all, as a cancellation_fee")
  void shouldCollectInFullOnlyWhenWalletCovers() {
    when(walletService.debitIfCovered(
            RIDER, "SYP", AMOUNT, WalletTransactionType.CANCELLATION_FEE, RIDE))
        .thenReturn(Optional.of(new WalletTransaction()), Optional.empty());

    assertThat(wallet.collectInFull(request(Charge.CANCELLATION_FEE))).isTrue();
    assertThat(wallet.collectInFull(request(Charge.CANCELLATION_FEE))).isFalse();
  }

  @Test
  @DisplayName("wallet: a cancellation fee debits what the wallet covers as a cancellation_fee")
  void shouldDebitCancellationFeeWhenWalletCollectsFee() {
    when(walletService.debitUpTo(
            RIDER, "SYP", AMOUNT, WalletTransactionType.CANCELLATION_FEE, RIDE))
        .thenReturn(AMOUNT);

    assertThat(wallet.collectUpTo(request(Charge.CANCELLATION_FEE))).isEqualByComparingTo(AMOUNT);
  }

  @Test
  @DisplayName("cash: nothing is collected on-platform and the wallet is never touched")
  void shouldCollectNothingWhenCash() {
    PaymentProvider provider =
        new PaymentProviders(List.of(cash, wallet)).forMethod(PaymentMethod.CASH);

    assertThat(provider.collectUpTo(request(Charge.FARE))).isEqualByComparingTo("0");
    assertThat(provider.collectInFull(request(Charge.CANCELLATION_FEE))).isFalse();
    verifyNoInteractions(walletService);
  }
}
