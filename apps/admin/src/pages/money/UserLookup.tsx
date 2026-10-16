import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { searchAdminRides } from '../../api/rides';
import { useAuth } from '../../auth/AuthContext';
import { usePermissions } from '../../auth/usePermissions';
import { DataTable, PageHeader } from '../../ui';
import { LoadFailure } from '../onboarding/ReviewUi';
import { classifyError, type FailureKind } from '../onboarding/review-utils';
import { candidatesFromRides, seenAsKey } from './lookup-utils';
import { isUuid } from './money-format';

/**
 * Minimal user lookup shared by the Users and Driver ledgers sections: a
 * pasted user ID opens the detail page directly; a phone (exact E.164) is
 * resolved through the admin ride search (`rides:view` — the only
 * contract-level search until a users API exists), listing the distinct
 * users on the matched rides. UC-A-13/15/27 entry point.
 */
export function UserLookup({ mode }: { mode: 'wallet' | 'ledger' }) {
  const { t } = useTranslation();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hintKey, setHintKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [results, setResults] = useState<ReturnType<typeof candidatesFromRides> | null>(null);

  // The Users section opens the trust profile when the admin may see it
  // (users:view, M11), the wallet otherwise; both are tabs of one profile.
  const openTrust = mode === 'wallet' && can('users:view');
  const target = (userId: string) =>
    mode === 'ledger'
      ? `/driver-ledgers/${userId}`
      : openTrust
        ? `/users/${userId}/trust`
        : `/users/${userId}/wallet`;

  async function search(event: FormEvent) {
    event.preventDefault();
    const value = input.trim();
    setHintKey(null);
    setFailure(null);
    setResults(null);
    if (value === '') {
      return;
    }
    if (isUuid(value)) {
      navigate(target(value));
      return;
    }
    if (!can('rides:view')) {
      setHintKey('money.lookup.needRidesPermission');
      return;
    }
    setBusy(true);
    try {
      const page = await searchAdminRides(apiClient, { phone: value });
      setResults(candidatesFromRides(page.items, mode === 'ledger'));
    } catch (error) {
      setFailure(classifyError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <PageHeader
        title={t(mode === 'wallet' ? 'money.lookup.usersTitle' : 'money.lookup.ledgersTitle')}
        description={t(
          mode === 'ledger'
            ? 'money.lookup.ledgersSubtitle'
            : openTrust
              ? 'money.lookup.usersSubtitleProfile'
              : 'money.lookup.usersSubtitle',
        )}
      />

      <form className="panel" onSubmit={(event) => void search(event)}>
        <div className="panel__row">
          <div className="form-field">
            <label htmlFor="money-lookup">{t('money.lookup.searchLabel')}</label>
            <input
              id="money-lookup"
              dir="ltr"
              value={input}
              placeholder={t('money.lookup.placeholder')}
              onChange={(event) => setInput(event.target.value)}
            />
          </div>
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {t('money.lookup.search')}
          </button>
        </div>
        <p className="panel__hint">{t('money.lookup.hint')}</p>
      </form>

      {hintKey ? (
        <p className="banner banner--info" role="status">
          {t(hintKey)}
        </p>
      ) : null}
      {failure ? <LoadFailure kind={failure} notFoundKey="review.errors.server" /> : null}
      {busy ? <div className="loading">{t('common.loading')}</div> : null}

      {results !== null ? (
        <DataTable
          title={t('money.lookup.resultsTitle')}
          isEmpty={results.length === 0}
          empty={t('money.lookup.empty')}
        >
          <thead>
            <tr>
              <th>{t('money.lookup.columns.name')}</th>
              <th>{t('money.lookup.columns.seenAs')}</th>
              <th>{t('money.lookup.columns.rides')}</th>
              <th className="table__cell--action">
                <span className="visually-hidden">{t('money.lookup.columns.open')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((candidate, index) => (
              <tr key={candidate.userId}>
                <td dir="auto">{candidate.name}</td>
                <td>{t(seenAsKey(candidate))}</td>
                <td className="table__muted">{candidate.rides}</td>
                <td className="table__cell--action">
                  <button
                    className={index === 0 ? 'btn btn--primary' : 'btn'}
                    type="button"
                    onClick={() =>
                      navigate(target(candidate.userId), { state: { name: candidate.name } })
                    }
                  >
                    {t(
                      mode === 'ledger'
                        ? 'money.lookup.openLedger'
                        : openTrust
                          ? 'money.lookup.openProfile'
                          : 'money.lookup.openWallet',
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : null}
    </section>
  );
}
