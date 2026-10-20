import { describe, expect, it } from 'vitest';

import { PAYMENT_STATUSES } from '../api/rides';
import ar from '../i18n/ar.json';
import en from '../i18n/en.json';

/**
 * V1 audit W1: a completed shared ride carried `paymentStatus: 'split'`, which the admin type and
 * both bundles lacked, so the ride detail showed a raw key. This mirrors every wire value of
 * backend `enums/PaymentStatus.java` (Vite denies reading files outside the app, so the list is
 * copied); a new backend value lands here, and then needs a type entry and an EN + AR label.
 */
const BACKEND_PAYMENT_STATUSES = [
  'pending',
  'paid_cash',
  'paid_wallet',
  'paid_mixed',
  'unpaid',
  'split',
];

describe('payment status labels (W1)', () => {
  it('the admin type lists every backend value', () => {
    expect([...PAYMENT_STATUSES].sort()).toEqual([...BACKEND_PAYMENT_STATUSES].sort());
  });

  it('every value has an EN and an AR ride-detail label', () => {
    const enLabels = en.rideDetail.paymentStatus as Record<string, string>;
    const arLabels = ar.rideDetail.paymentStatus as Record<string, string>;
    for (const value of BACKEND_PAYMENT_STATUSES) {
      expect(enLabels[value], `en ${value}`).toBeTruthy();
      expect(arLabels[value], `ar ${value}`).toBeTruthy();
    }
  });
});
