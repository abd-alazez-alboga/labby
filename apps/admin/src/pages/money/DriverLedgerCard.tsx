import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { getDriverLedger, type DriverBalanceEntry } from '../../api/money';
import { useAuth } from '../../auth/AuthContext';
import { bdiMark, withBdi } from '../../ui';
import { FloorStatusChip, Money } from './MoneyUi';

/**
 * The profile's driver ledger card (UC-A-13 "driver ledger (if driver)", V1
 * audit W4, board V1FAdminUserReportsLedger): per currency, the balance, the
 * region floor that applies and the COM-03 status, with a link to the full
 * ledger. The caller renders it for driver accounts and `settlements:view`
 * only. Best effort — hidden while loading or on failure.
 */
export function DriverLedgerCard({ userId, name }: { userId: string; name?: string }) {
  const { t } = useTranslation();
  const { apiClient } = useAuth();
  const [balances, setBalances] = useState<DriverBalanceEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBalances(null);
    getDriverLedger(apiClient, userId, { page: 0, size: 1 })
      .then((view) => !cancelled && setBalances(view.balances))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiClient, userId]);

  if (balances === null) {
    return null;
  }

  return (
    <section className="decision-panel ledger-card" aria-labelledby="ledger-card-title">
      <h2 id="ledger-card-title" className="decision-panel__title">
        {t('trust.ledgerCard.title')}
      </h2>
      {balances.length === 0 ? (
        <p className="panel__hint">{t('trust.ledgerCard.empty')}</p>
      ) : (
        balances.map((entry) => (
          <dl key={entry.currency} className="ledger-card__lines">
            <div className="ledger-card__line">
              <dt>{t('trust.ledgerCard.balance')}</dt>
              <dd>
                <Money amount={entry.balance} currency={entry.currency} />
              </dd>
            </div>
            <div className="ledger-card__line">
              <dt>
                {entry.floorRegionName
                  ? withBdi(
                      t('trust.ledgerCard.floorIn', { region: bdiMark(entry.floorRegionName) }),
                    )
                  : t('trust.ledgerCard.floorDefault')}
              </dt>
              <dd>
                <Money amount={entry.floor} currency={entry.currency} />
              </dd>
            </div>
            <div className="ledger-card__line">
              <dt>{t('trust.ledgerCard.status')}</dt>
              <dd>
                <FloorStatusChip status={entry.status} />
              </dd>
            </div>
          </dl>
        ))
      )}
      <Link
        className="btn btn--block"
        to={`/driver-ledgers/${userId}`}
        state={name ? { name } : undefined}
      >
        {t('trust.ledgerCard.open')}
      </Link>
    </section>
  );
}
