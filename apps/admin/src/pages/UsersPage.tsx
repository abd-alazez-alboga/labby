import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import {
  listAdminUsers,
  type AdminUser,
  type Page,
  type UserFilter,
  type UserRole,
} from '../api/analytics';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { DataTable, FilterChips, PageHeader, StatusChip, TablePager } from '../ui';
import {
  ACCOUNT_TONES,
  dayRange,
  DIRECTORY_PAGE_SIZE,
  oneOf,
  useUrlFilters,
} from './directory/directory-utils';
import { highlightName, SEARCH_DEBOUNCE_MS } from './directory/user-search-utils';
import { UserSearchBox } from './directory/UserSearch';
import { ExportCsvButton, ExportFailureBanner } from './exports/CsvExport';
import { exportNote, useCsvExport } from './exports/use-csv-export';
import { UserLookup } from './money/UserLookup';
import { formatMoment, formatNumber, isUuid } from './money/money-format';

const ROLES: readonly UserRole[] = ['rider', 'driver', 'admin'];

/**
 * "Users" section (UC-A-13/15 + the M15 list, approved boards "Admin · Users
 * list" and V1FAdminUsersSearch): a "Find a user" search box — any part of
 * the name or a phone in any format, over GET /admin/users `q` (V1 audit H8),
 * so a user with no rides is found too; a pasted user ID opens that user —
 * then every matching account newest first (users:view) with role and
 * sign-up filters and Export CSV of exactly that filter. Wallet-only admins
 * keep the ride-history lookup.
 */
export default function UsersPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canList = can('users:view');
  const navigate = useNavigate();
  const { params, update, page } = useUrlFilters();

  const role = oneOf(params.get('role'), ROLES);
  const fromDay = params.get('from') ?? '';
  const toDay = params.get('to') ?? '';
  const query = (params.get('q') ?? '').trim();
  const filter = useMemo<UserFilter>(
    () => ({ role, q: query || undefined, ...dayRange(fromDay, toDay) }),
    [role, query, fromDay, toDay],
  );
  const exporter = useCsvExport('users', filter);

  const [result, setResult] = useState<Page<AdminUser> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [input, setInput] = useState(query);
  const searchRef = useRef<HTMLInputElement>(null);

  // The URL is the truth (back from a profile keeps the search).
  useEffect(() => {
    setInput(query);
  }, [query]);

  // Search as the admin types, once they pause.
  const typed = input.trim();
  useEffect(() => {
    if (!canList || typed === query) {
      return;
    }
    const timer = window.setTimeout(() => update({ q: typed }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [canList, typed, query, update]);

  useEffect(() => {
    if (!canList) {
      return;
    }
    let cancelled = false;
    setResult(null);
    setFailed(false);
    listAdminUsers(apiClient, filter, page, DIRECTORY_PAGE_SIZE)
      .then((loaded) => !cancelled && setResult(loaded))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [apiClient, canList, filter, page, attempt]);

  if (!canList) {
    return <UserLookup mode="wallet" />;
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.totalItems / DIRECTORY_PAGE_SIZE)) : 1;
  const note = result ? exportNote(exporter, t, 'users', result.totalItems, language) : null;

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (isUuid(typed)) {
      navigate(`/users/${typed.toLowerCase()}/trust`);
      return;
    }
    update({ q: typed });
  }

  function clearSearch() {
    setInput('');
    update({ q: '' });
    searchRef.current?.focus();
  }

  const emptySearch = (
    <div className="search-empty">
      <span className="search-empty__title" dir="auto">
        {t('directory.users.search.noMatchTitle', { query })}
      </span>
      <span className="search-empty__body">{t('directory.users.search.noMatchBody')}</span>
      <button className="btn" type="button" onClick={clearSearch}>
        {t('directory.users.search.clear')}
      </button>
    </div>
  );

  return (
    <section className="page">
      <PageHeader
        title={t('money.lookup.usersTitle')}
        description={t('directory.users.subtitle')}
        actions={<ExportCsvButton state={exporter} />}
      />
      <UserSearchBox
        title={t('directory.users.search.title')}
        label={t('directory.users.search.label')}
        hint={t('directory.users.search.hint')}
        value={input}
        inputRef={searchRef}
        onChange={setInput}
        onSubmit={submitSearch}
        onClear={clearSearch}
      />
      <ExportFailureBanner state={exporter} />
      <div className="directory-filters">
        <FilterChips
          label={t('directory.users.roleLabel')}
          options={[
            { value: '', label: t('directory.all') },
            ...ROLES.map((value) => ({ value, label: t(`directory.users.roleFilter.${value}`) })),
          ]}
          isSelected={(value) => value === (role ?? '')}
          onSelect={(value) => update({ role: value })}
        />
        <span className="directory-filters__spacer" />
        <span className="directory-filters__label">{t('directory.users.signedUp')}</span>
        <input
          type="date"
          aria-label={t('directory.users.signedUpFrom')}
          value={fromDay}
          onChange={(event) => update({ from: event.target.value })}
        />
        <span className="table__muted">–</span>
        <input
          type="date"
          aria-label={t('directory.users.signedUpTo')}
          value={toDay}
          onChange={(event) => update({ to: event.target.value })}
        />
      </div>

      {failed ? (
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
          empty={query ? emptySearch : t('directory.users.empty')}
          footer={
            <TablePager
              status={[
                ...(query
                  ? [
                      t('directory.users.search.matches', {
                        count: result.totalItems,
                        total: formatNumber(result.totalItems, language),
                        query,
                      }),
                      totalPages > 1
                        ? t('money.pageOf', { page: page + 1, total: totalPages })
                        : null,
                    ]
                  : [
                      t('directory.showing', {
                        total: formatNumber(result.totalItems, language),
                        page: page + 1,
                        pages: totalPages,
                      }),
                    ]),
                note,
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
              <th>{t('directory.users.columns.user')}</th>
              <th>{t('directory.users.columns.roles')}</th>
              <th>{t('directory.users.columns.account')}</th>
              <th>{t('directory.users.columns.signedUp')}</th>
              <th className="table__cell--action">
                <span className="visually-hidden">{t('directory.open')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((user, index) => (
              <tr key={user.userId}>
                <td>
                  <span className="directory-person">
                    <span className="table__strong" dir="auto">
                      {query ? highlightName(user.name, query) : user.name}
                    </span>
                    {user.phone ? (
                      <span className="table__muted" dir="ltr">
                        {user.phone}
                      </span>
                    ) : null}
                  </span>
                </td>
                <td>
                  <span className="directory-chips">
                    {user.roles.map((entry) => (
                      <StatusChip
                        key={entry.role}
                        tone={
                          entry.state === 'suspended'
                            ? 'danger'
                            : entry.role === 'driver'
                              ? 'accent'
                              : 'neutral'
                        }
                      >
                        {t(`directory.users.role.${entry.role}`)}
                      </StatusChip>
                    ))}
                  </span>
                </td>
                <td>
                  <StatusChip tone={ACCOUNT_TONES[user.state]}>
                    {t(`directory.users.account.${user.state}`)}
                  </StatusChip>
                </td>
                <td className="table__muted">{formatMoment(user.createdAt, language)}</td>
                <td className="table__cell--action">
                  <Link
                    className={index === 0 ? 'btn btn--small btn--primary' : 'btn btn--small'}
                    to={`/users/${user.userId}/trust`}
                    state={{ name: user.name }}
                  >
                    {t('directory.open')}
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
