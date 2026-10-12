import { useTranslation } from 'react-i18next';

/** The translated display label for an ISO currency code (NFR-I2). */
export function useCurrencyLabel(): (currency: string) => string {
  const { t } = useTranslation();
  return (currency) => t(`money.currency.${currency}`, { defaultValue: currency });
}
