package com.labby.backend.service;

import com.labby.backend.enums.PaymentMethod;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * Ride-payment seam (ES-06, NFR-M1, SD-03): collects what a payer owes on a ride by their payment
 * method and reports how much was collected ON-PLATFORM. V1 has one provider per method: {@link
 * WalletPaymentProvider} (the earned-credit wallet — no top-ups) and {@link CashPaymentProvider}
 * (paid in person, confirmed later by the driver, so nothing moves on-platform). V2 card or
 * digital-wallet gateways are new implementations behind this interface; {@link PaymentProviders}
 * selects by method. Callers run inside the money engine's transaction and keep its lock order (the
 * payer's wallet before any driver balance); what the payer still owes after a collection stays the
 * engine's to settle (cash due, earmarked or pending rider dues).
 */
public interface PaymentProvider {

  /**
   * The payment method this provider collects.
   *
   * @return the method; exactly one provider exists per method
   */
  PaymentMethod method();

  /**
   * Collects as much of the amount as this method can take on-platform now (PAY-02: the wallet pays
   * what it can).
   *
   * @param request who pays what, for which ride
   * @return the amount collected on-platform, 0 .. {@code request.amount()}
   */
  BigDecimal collectUpTo(PaymentRequest request);

  /**
   * Collects exactly the amount on-platform, or nothing — the full-or-nothing collection of a
   * carried rider due (owner ruling (a)). A shortfall is not an error.
   *
   * @param request who pays what, for which ride
   * @return true when the whole amount was collected
   */
  boolean collectInFull(PaymentRequest request);

  /** What a collection is for (the ledger entry type it produces). */
  enum Charge {
    /** A ride's fare, or a shared-ride member's share. */
    FARE,
    /** A cancellation fee, collected at cancellation or carried as a rider due. */
    CANCELLATION_FEE
  }

  /**
   * One collection.
   *
   * @param payerUserId the paying rider
   * @param currency the ride's ISO 4217 currency
   * @param amount the positive amount owed
   * @param charge what it is for
   * @param rideId the ride the collection is linked to
   */
  record PaymentRequest(
      UUID payerUserId, String currency, BigDecimal amount, Charge charge, UUID rideId) {}
}
