import { describe, expect, it } from 'vitest';

import { formatNumber, formatSigned, parseAmount } from '../pages/money/money-format';

describe('money format', () => {
  it('parses grouped amounts with at most 2 decimals', () => {
    expect(parseAmount('20,000')).toBe(20000);
    expect(parseAmount(' 1 500.5 ')).toBe(1500.5);
    expect(parseAmount('12.25')).toBe(12.25);
  });

  it('rejects anything the server would not accept as an amount', () => {
    for (const raw of ['', '0', '0.00', '-5', '+5', '1e3', '0x10', '1.234', '.5', '5.', 'abc']) {
      expect(parseAmount(raw)).toBeNull();
    }
  });

  it('uses a true minus sign in Arabic despite the leading bidi mark', () => {
    const arabic = formatNumber(-430000, 'ar');
    expect(arabic).not.toContain('-');
    expect(arabic).toContain('−430,000');
    expect(formatNumber(-430000, 'en')).toBe('−430,000');
    expect(formatSigned(-2000, 'ar')).toBe('−2,000');
  });
});
