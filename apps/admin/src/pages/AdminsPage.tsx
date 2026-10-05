import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../api/client';
import {
  changeAdminRole,
  createAdmin,
  deactivateAdmin,
  listAdmins,
  listRoles,
  reactivateAdmin,
  type AdminAccount,
  type RoleSummary,
} from '../api/rbac';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';

type Notice =
  { kind: 'created' } | { kind: 'grantedExisting' } | { kind: 'error'; messageKey: string };

/** Maps the contract's admin-mutation failures (rbac-v1.yaml) to messages. */
function mapAdminError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'admins.errors.conflict';
    }
    if (error.status === 400) {
      return 'admins.errors.validation';
    }
  }
  return 'admins.errors.generic';
}

/**
 * UC-A-01/02: admin accounts list, creation with exactly one role, role
 * change, deactivate/reactivate. Listing needs admins:view (the route
 * guard); every mutating control additionally needs admins:manage and is
 * hidden without it — the backend enforces the same codes regardless.
 */
export default function AdminsPage() {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canManage = can('admins:manage');

  const [admins, setAdmins] = useState<AdminAccount[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Role options for the selects; loading them needs roles:view server-side.
  const [roles, setRoles] = useState<RoleSummary[] | null>(null);
  const [rolesFailed, setRolesFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAdmins(apiClient)
      .then((list) => {
        if (!cancelled) {
          setAdmins(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
        }
      });
    if (canManage) {
      listRoles(apiClient)
        .then((list) => {
          if (!cancelled) {
            setRoles(list.map(({ id, name: roleName }) => ({ id, name: roleName })));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRolesFailed(true);
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [apiClient, canManage]);

  const replaceAdmin = useCallback((next: AdminAccount) => {
    setAdmins((current) =>
      current ? current.map((admin) => (admin.id === next.id ? next : admin)) : current,
    );
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      const response = await createAdmin(apiClient, {
        phone: phone.trim(),
        name: name.trim(),
        roleId,
      });
      setAdmins((current) => {
        if (!current) {
          return current;
        }
        const exists = current.some((admin) => admin.id === response.admin.id);
        return exists
          ? current.map((admin) => (admin.id === response.admin.id ? response.admin : admin))
          : [response.admin, ...current];
      });
      setNotice({ kind: response.mode === 'created' ? 'created' : 'grantedExisting' });
      setPhone('');
      setName('');
      setRoleId('');
    } catch (error) {
      setNotice({
        kind: 'error',
        messageKey:
          error instanceof ApiError && error.status === 409
            ? 'admins.errors.alreadyAdmin'
            : mapAdminError(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function runRowAction(userId: string, action: () => Promise<AdminAccount>) {
    setBusyId(userId);
    setNotice(null);
    try {
      replaceAdmin(await action());
    } catch (error) {
      setNotice({ kind: 'error', messageKey: mapAdminError(error) });
    } finally {
      setBusyId(null);
    }
  }

  function handleRoleChange(admin: AdminAccount, nextRoleId: string) {
    if (nextRoleId === admin.role.id) {
      return;
    }
    void runRowAction(admin.id, () => changeAdminRole(apiClient, admin.id, nextRoleId));
  }

  function handleDeactivate(admin: AdminAccount) {
    setConfirmingId(null);
    void runRowAction(admin.id, () => deactivateAdmin(apiClient, admin.id));
  }

  function handleReactivate(admin: AdminAccount) {
    void runRowAction(admin.id, () => reactivateAdmin(apiClient, admin.id));
  }

  return (
    <section>
      <h1 className="page__title">{t('admins.title')}</h1>

      {notice?.kind === 'created' ? (
        <p className="banner banner--info" role="status">
          {t('admins.createdNotice')}
        </p>
      ) : null}
      {notice?.kind === 'grantedExisting' ? (
        <p className="banner banner--info" role="status">
          {t('admins.grantedExistingNotice')}
        </p>
      ) : null}
      {notice?.kind === 'error' ? (
        <p className="banner banner--error" role="alert">
          {t(notice.messageKey)}
        </p>
      ) : null}

      {canManage ? (
        <form className="card panel" onSubmit={(event) => void handleCreate(event)}>
          <h2 className="panel__title">{t('admins.createTitle')}</h2>
          <p className="panel__hint">{t('admins.createHint')}</p>
          {rolesFailed ? (
            <p className="banner banner--error" role="alert">
              {t('admins.errors.rolesUnavailable')}
            </p>
          ) : null}
          <div className="panel__row">
            <div className="form-field">
              <label htmlFor="admin-phone">{t('admins.phoneLabel')}</label>
              <input
                id="admin-phone"
                type="tel"
                dir="ltr"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
                disabled={submitting}
              />
            </div>
            <div className="form-field">
              <label htmlFor="admin-name">{t('admins.nameLabel')}</label>
              <input
                id="admin-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                required
                disabled={submitting}
              />
            </div>
            <div className="form-field">
              <label htmlFor="admin-role">{t('admins.roleLabel')}</label>
              <select
                id="admin-role"
                value={roleId}
                onChange={(event) => setRoleId(event.target.value)}
                required
                disabled={submitting || !roles}
              >
                <option value="" disabled>
                  {t('admins.rolePlaceholder')}
                </option>
                {(roles ?? []).map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn--primary" type="submit" disabled={submitting || !roles}>
              {submitting ? t('admins.creating') : t('admins.createSubmit')}
            </button>
          </div>
        </form>
      ) : null}

      {loadFailed ? (
        <p className="banner banner--error" role="alert">
          {t('admins.errors.loadFailed')}
        </p>
      ) : admins === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('admins.columns.name')}</th>
              <th>{t('admins.columns.phone')}</th>
              <th>{t('admins.columns.role')}</th>
              <th>{t('admins.columns.state')}</th>
              <th>{t('admins.columns.grantedAt')}</th>
              {canManage ? <th>{t('admins.columns.actions')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {admins.map((admin) => (
              <tr key={admin.id}>
                <td>{admin.name}</td>
                <td dir="ltr">{admin.phone}</td>
                <td>
                  {canManage && roles ? (
                    <select
                      aria-label={t('admins.changeRoleFor', { name: admin.name })}
                      value={admin.role.id}
                      onChange={(event) => handleRoleChange(admin, event.target.value)}
                      disabled={busyId === admin.id}
                    >
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    admin.role.name
                  )}
                </td>
                <td>
                  <span className={`state state--${admin.state}`}>
                    {t(`admins.states.${admin.state}`)}
                  </span>
                </td>
                <td>{new Date(admin.grantedAt).toLocaleString(i18n.language)}</td>
                {canManage ? (
                  <td>
                    {admin.state === 'active' ? (
                      confirmingId === admin.id ? (
                        <span className="table__confirm">
                          {t('admins.deactivateConfirm')}
                          <button
                            className="btn btn--danger"
                            type="button"
                            onClick={() => handleDeactivate(admin)}
                            disabled={busyId === admin.id}
                          >
                            {t('common.confirm')}
                          </button>
                          <button
                            className="btn"
                            type="button"
                            onClick={() => setConfirmingId(null)}
                          >
                            {t('common.cancel')}
                          </button>
                        </span>
                      ) : (
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setConfirmingId(admin.id)}
                          disabled={busyId === admin.id}
                        >
                          {t('admins.deactivate')}
                        </button>
                      )
                    ) : (
                      <button
                        className="btn"
                        type="button"
                        onClick={() => handleReactivate(admin)}
                        disabled={busyId === admin.id}
                      >
                        {t('admins.reactivate')}
                      </button>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
