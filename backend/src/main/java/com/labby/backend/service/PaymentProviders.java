package com.labby.backend.service;

import com.labby.backend.enums.PaymentMethod;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Selects the {@link PaymentProvider} of a payment method. Fails fast at startup unless every
 * {@link PaymentMethod} has exactly one provider, so a method can never silently go uncollected.
 */
@Component
public class PaymentProviders {

  private final Map<PaymentMethod, PaymentProvider> byMethod = new EnumMap<>(PaymentMethod.class);

  public PaymentProviders(List<PaymentProvider> providers) {
    for (PaymentProvider provider : providers) {
      PaymentProvider previous = byMethod.put(provider.method(), provider);
      if (previous != null) {
        throw new IllegalStateException("Two payment providers for method " + provider.method());
      }
    }
    for (PaymentMethod method : PaymentMethod.values()) {
      if (!byMethod.containsKey(method)) {
        throw new IllegalStateException("No payment provider for method " + method);
      }
    }
  }

  /**
   * The provider that collects a method.
   *
   * @param method the payer's payment method
   * @return its provider
   */
  public PaymentProvider forMethod(PaymentMethod method) {
    return byMethod.get(method);
  }
}
