import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  listAdminUsers,
  type AdminUser,
  type Page,
  type UserFilter,
  type UserRole,
} from '../api/analytics';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { DataTable, FilterChips, StatusChip, TablePager } from '../ui';
import {
  ACCOUNT_TONES,
  dayRange,
  DIRECTORY_PAGE_SIZE,
  oneOf,
  useUrlFilters,
} from './directory/directory-utils';
import { ExportCsvButton, ExportFailureBanner } from './exports/CsvExport';
import { exportNote, useCsvExport } from './exports/use-csv-export';
import { UserLookup } from './money/UserLookup';
import { formatMoment, formatNumber } from './money/money-format';

const ROLES: readonly UserRole[] = ['rider', 'driver', 'admin'];

/**
 * "Users" section (UC-A-13/15 lookup + the M15 list, approved board "Admin ·
 * Users list"): the existing find-a-user lookup, then every account newest
 * first over GET /admin/users (users:view) with role and sign-up filters and
 * Export CSV of exactly that filter. Wallet-only admins keep the lookup.
 */
export default function UsersPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canList = can('users:view');
  const { params, update, page } = useUrlFilters();

  const role = oneOf(params.get('role'), ROLES);
  const fromDay = params.get('from') ?? '';
  const toDay = params.get('to') ?? '';
  const filter = useMemo<UserFilter>(
    () => ({ role, ...dayRange(fromDay, toDay) }),
    [role, fromDay, toDay],
  );
  const exporter = useCsvExport('users', filter);

  const [result, setResult] = useState<Page<AdminUser> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

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

  return (
    <UserLookup
      mode="wallet"
      description={t('directory.users.subtitle')}
      actions={<ExportCsvButton state={exporter} />}
    >
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
          empty={t('directory.users.empty')}
          footer={
            <TablePager
              status={[
                t('directory.showing', {
                  total: formatNumber(result.totalItems, language),
                  page: page + 1,
                  pages: totalPages,
                }),
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
                      {user.name}
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
    </UserLookup>
  );
}
