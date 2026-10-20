import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { queryAuditLog, type AuditLogPage as AuditPage, type AuditLogQuery } from '../api/rbac';
import { useAuth } from '../auth/AuthContext';
import { DataTable, PageHeader, TablePager } from '../ui';
import { latinLocale } from './money/money-format';

const PAGE_SIZE = 25;

/** A datetime-local input value as the contract's ISO date-time, or undefined. */
function toIso(local: string): string | undefined {
  return local ? new Date(local).toISOString() : undefined;
}

/**
 * UC-A-04: the append-only audit log, newest first, with combinable
 * filters and pagination. Read-only by design — no mutation exists
 * (RBAC-05). Requires audit:view (the route guard).
 */
export default function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();

  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [targetId, setTargetId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [query, setQuery] = useState<AuditLogQuery>({ page: 0, size: PAGE_SIZE });
  const [result, setResult] = useState<AuditPage | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    queryAuditLog(apiClient, query)
      .then((page) => {
        if (!cancelled) {
          setResult(page);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, query]);

  function handleFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery({
      actorId: actorId.trim() || undefined,
      action: action.trim() || undefined,
      targetType: targetType.trim() || undefined,
      targetId: targetId.trim() || undefined,
      from: toIso(from),
      to: toIso(to),
      page: 0,
      size: PAGE_SIZE,
    });
  }

  const page = query.page ?? 0;
  const lastPage = result ? Math.max(0, Math.ceil(result.totalItems / result.size) - 1) : 0;

  return (
    <section className="page">
      <PageHeader title={t('audit.title')} description={t('audit.subtitle')} />

      <form className="card panel" onSubmit={handleFilter}>
        <div className="panel__row">
          <div className="form-field">
            <label htmlFor="audit-actor">{t('audit.filters.actorId')}</label>
            <input
              id="audit-actor"
              dir="ltr"
              value={actorId}
              onChange={(event) => setActorId(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="audit-action">{t('audit.filters.action')}</label>
            <input
              id="audit-action"
              dir="ltr"
              placeholder="role.update"
              value={action}
              onChange={(event) => setAction(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="audit-target-type">{t('audit.filters.targetType')}</label>
            <input
              id="audit-target-type"
              dir="ltr"
              value={targetType}
              onChange={(event) => setTargetType(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="audit-target-id">{t('audit.filters.targetId')}</label>
            <input
              id="audit-target-id"
              dir="ltr"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="audit-from">{t('audit.filters.from')}</label>
            <input
              id="audit-from"
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="audit-to">{t('audit.filters.to')}</label>
            <input
              id="audit-to"
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <button className="btn btn--primary" type="submit">
            {t('audit.apply')}
          </button>
        </div>
      </form>

      {loadFailed ? (
        <p className="banner banner--error" role="alert">
          {t('audit.errors.loadFailed')}
        </p>
      ) : result === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : result.items.length === 0 ? (
        <p className="banner banner--info">{t('audit.empty')}</p>
      ) : (
        <DataTable
          footer={
            <TablePager
              status={t('audit.pageOf', {
                page: page + 1,
                total: lastPage + 1,
                items: result.totalItems,
              })}
              previousLabel={t('audit.previous')}
              nextLabel={t('audit.next')}
              canPrevious={page > 0}
              canNext={page < lastPage}
              onPrevious={() => setQuery((q) => ({ ...q, page: page - 1 }))}
              onNext={() => setQuery((q) => ({ ...q, page: page + 1 }))}
            />
          }
        >
          <thead>
            <tr>
              <th>{t('audit.columns.when')}</th>
              <th>{t('audit.columns.actor')}</th>
              <th>{t('audit.columns.action')}</th>
              <th>{t('audit.columns.target')}</th>
              <th>{t('audit.columns.details')}</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((entry) => (
              <tr key={entry.id}>
                <td>{new Date(entry.createdAt).toLocaleString(latinLocale(i18n.language))}</td>
                <td>{entry.actorName}</td>
                <td>
                  <code dir="ltr">{entry.action}</code>
                </td>
                <td dir="ltr">
                  {entry.targetType ? `${entry.targetType} ${entry.targetId ?? ''}`.trim() : '—'}
                </td>
                <td>
                  {entry.before || entry.after ? (
                    <details>
                      <summary>{t('audit.beforeAfter')}</summary>
                      <pre dir="ltr" className="audit__diff">
                        {JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}
