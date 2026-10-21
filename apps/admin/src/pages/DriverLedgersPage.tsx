import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { listAdminUsers, type AdminUser, type Page, type UserFilter } from '../api/analytics';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { DataTable, PageHeader, StatusChip, TablePager } from '../ui';
import { ACCOUNT_TONES, DIRECTORY_PAGE_SIZE, useUrlFilters } from './directory/directory-utils';
import { highlightName, SEARCH_DEBOUNCE_MS } from './directory/user-search-utils';
import { UserSearchBox } from './directory/UserSearch';
import { UserLookup } from './money/UserLookup';
import { formatMoment, formatNumber, isUuid } from './money/money-format';

/**
 * "Driver ledgers" section entry (UC-A-27): find a driver, open the ledger.
 * With users:view the driver is found by any part of the name or a phone in
 * any format over GET /admin/users `q` + `role=driver` — the Users page's
 * search (board V1FAdminUsersSearch), so a driver with no rides is found too;
 * a pasted user ID opens that ledger. Without users:view the ride-history
 * lookup stays.
 */
export default function DriverLedgersPage() {
  const { can } = usePermissions();
  return can('users:view') ? <DriverSearch /> : <UserLookup mode="ledger" />;
}

function DriverSearch() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const navigate = useNavigate();
  const { params, update, page } = useUrlFilters();

  const query = (params.get('q') ?? '').trim();
  const filter = useMemo<UserFilter>(() => ({ role: 'driver', q: query }), [query]);

  const [result, setResult] = useState<Page<AdminUser> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [input, setInput] = useState(query);
  const searchRef = useRef<HTMLInputElement>(null);

  // The URL is the truth (back from a ledger keeps the search).
  useEffect(() => {
    setInput(query);
  }, [query]);

  // Search as the admin types, once they pause.
  const typed = input.trim();
  useEffect(() => {
    if (typed === query) {
      return;
    }
    const timer = window.setTimeout(() => update({ q: typed }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [typed, query, update]);

  // A lookup, not a list: nothing is fetched until there is something to find.
  useEffect(() => {
    setResult(null);
    setFailed(false);
    if (filter.q === '') {
      return;
    }
    let cancelled = false;
    listAdminUsers(apiClient, filter, page, DIRECTORY_PAGE_SIZE)
      .then((loaded) => !cancelled && setResult(loaded))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [apiClient, filter, page, attempt]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (isUuid(typed)) {
      navigate(`/driver-ledgers/${typed.toLowerCase()}`);
      return;
    }
    update({ q: typed });
  }

  function clearSearch() {
    setInput('');
    update({ q: '' });
    searchRef.current?.focus();
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.totalItems / DIRECTORY_PAGE_SIZE)) : 1;

  const emptySearch = (
    <div className="search-empty">
      <span className="search-empty__title" dir="auto">
        {t('money.ledgerSearch.noMatchTitle', { query })}
      </span>
      <span className="search-empty__body">{t('money.ledgerSearch.noMatchBody')}</span>
      <button className="btn" type="button" onClick={clearSearch}>
        {t('directory.users.search.clear')}
      </button>
    </div>
  );

  return (
    <section className="page">
      <PageHeader
        title={t('money.lookup.ledgersTitle')}
        description={t('money.lookup.ledgersSubtitle')}
      />
      <UserSearchBox
        title={t('money.ledgerSearch.title')}
        label={t('money.ledgerSearch.label')}
        hint={t('money.ledgerSearch.hint')}
        value={input}
        inputRef={searchRef}
        onChange={setInput}
        onSubmit={submitSearch}
        onClear={clearSearch}
      />

      {query === '' ? null : failed ? (
        <p className="banner banner--error" role="alert">
          {t('directory.loadFailed')}{' '}
          <button className="btn btn--small" type="button" onClick={() => setAttempt((n) => n + 1)}>
            {t('surgeLive.retry')}
          </button>
        </p>
      ) : result === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : (
        <DataTable
          isEmpty={result.items.length === 0}
          empty={emptySearch}
          footer={
            <TablePager
              status={[
                t('money.ledgerSearch.matches', {
                  count: result.totalItems,
                  total: formatNumber(result.totalItems, language),
                  query,
                }),
                totalPages > 1 ? t('money.pageOf', { page: page + 1, total: totalPages }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              previousLabel={t('audit.previous')}
              nextLabel={t('audit.next')}
              canPrevious={page > 0}
              canNext={page < totalPages - 1}
              onPrevious={() => update({ page: String(page - 1) })}
              onNext={() => update({ page: String(page + 1) })}
            />
          }
        >
          <thead>
            <tr>
              <th>{t('directory.drivers.columns.driver')}</th>
              <th>{t('directory.users.columns.account')}</th>
              <th>{t('directory.users.columns.signedUp')}</th>
              <th className="table__cell--action">
                <span className="visually-hidden">{t('money.lookup.columns.open')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((driver, index) => (
              <tr key={driver.userId}>
                <td>
                  <span className="directory-person">
                    <span className="table__strong" dir="auto">
                      {highlightName(driver.name, query)}
                    </span>
                    {driver.phone ? (
                      <span className="table__muted" dir="ltr">
                        {driver.phone}
                      </span>
                    ) : null}
                  </span>
                </td>
                <td>
                  <StatusChip tone={ACCOUNT_TONES[driver.state]}>
                    {t(`directory.users.account.${driver.state}`)}
                  </StatusChip>
                </td>
                <td className="table__muted">{formatMoment(driver.createdAt, language)}</td>
                <td className="table__cell--action">
                  <Link
                    className={index === 0 ? 'btn btn--small btn--primary' : 'btn btn--small'}
                    to={`/driver-ledgers/${driver.userId}`}
                    state={{ name: driver.name }}
                  >
                    {t('money.lookup.openLedger')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}
