import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../api/client';
import {
  createRole,
  deleteRole,
  listPermissions,
  listRoles,
  updateRole,
  type Permission,
  type PermissionCode,
  type Role,
} from '../api/rbac';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';

type EditorState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; role: Role }
  | { mode: 'view'; role: Role };

/**
 * The Super Admin system role is fully immutable (RBAC-01); other system
 * roles (Support) keep their name but their permission set is editable
 * (RBAC-04). System role names never change, so the seeded name is a
 * stable discriminator on the wire.
 */
function isImmutable(role: Role): boolean {
  return role.isSystem && role.name === 'Super Admin';
}

function mapRoleError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'roles.errors.conflict';
    }
    if (error.status === 400) {
      return 'roles.errors.validation';
    }
  }
  return 'roles.errors.generic';
}

/**
 * UC-A-03: roles with their permission sets, plus the role builder — a
 * permission checklist grouped by domain, fed by the code-seeded catalog.
 * Viewing needs roles:view (the route guard); create/edit/delete need
 * roles:manage and are hidden without it.
 */
export default function RolesPage() {
  const { t } = useTranslation();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canManage = can('roles:manage');

  /** i18n label for a catalog code, falling back to the raw code for future catalog growth. */
  function permissionLabel(code: string): string {
    const separator = code.indexOf(':');
    const key = `permissionCodes.${code.slice(0, separator)}.${code.slice(separator + 1)}`;
    return t(key, { defaultValue: code });
  }

  const [roles, setRoles] = useState<Role[] | null>(null);
  const [catalog, setCatalog] = useState<Permission[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [roleName, setRoleName] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<PermissionCode>>(new Set());
  const [editorError, setEditorError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listRoles(apiClient), listPermissions(apiClient)])
      .then(([roleList, permissionList]) => {
        if (!cancelled) {
          setRoles(roleList);
          setCatalog(permissionList);
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
  }, [apiClient]);

  // Checklist groups, in the catalog's stable order.
  const domains = useMemo(() => {
    const groups: { domain: string; permissions: Permission[] }[] = [];
    for (const permission of catalog ?? []) {
      const group = groups.find((g) => g.domain === permission.domain);
      if (group) {
        group.permissions.push(permission);
      } else {
        groups.push({ domain: permission.domain, permissions: [permission] });
      }
    }
    return groups;
  }, [catalog]);

  function openEditor(next: EditorState) {
    setEditor(next);
    setEditorError(null);
    if (next.mode === 'create') {
      setRoleName('');
      setSelected(new Set());
    } else if (next.mode === 'edit' || next.mode === 'view') {
      setRoleName(next.role.name);
      setSelected(new Set(next.role.permissions));
    }
  }

  function toggle(code: PermissionCode) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editor.mode !== 'create' && editor.mode !== 'edit') {
      return;
    }
    setSubmitting(true);
    setEditorError(null);
    const body = { name: roleName.trim(), permissions: [...selected] };
    try {
      if (editor.mode === 'create') {
        const created = await createRole(apiClient, body);
        setRoles((current) => (current ? [...current, created] : current));
      } else {
        const updated = await updateRole(apiClient, editor.role.id, body);
        setRoles((current) =>
          current ? current.map((role) => (role.id === updated.id ? updated : role)) : current,
        );
      }
      setEditor({ mode: 'closed' });
    } catch (error) {
      setEditorError(mapRoleError(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(role: Role) {
    setConfirmingDeleteId(null);
    setPageError(null);
    try {
      await deleteRole(apiClient, role.id);
      setRoles((current) => (current ? current.filter((r) => r.id !== role.id) : current));
      if ((editor.mode === 'edit' || editor.mode === 'view') && editor.role.id === role.id) {
        setEditor({ mode: 'closed' });
      }
    } catch (error) {
      setPageError(
        error instanceof ApiError && error.status === 409
          ? 'roles.errors.deleteBlocked'
          : mapRoleError(error),
      );
    }
  }

  const editorOpen = editor.mode !== 'closed';
  const readOnly = editor.mode === 'view';

  return (
    <section>
      <h1 className="page__title">{t('roles.title')}</h1>

      {pageError ? (
        <p className="banner banner--error" role="alert">
          {t(pageError)}
        </p>
      ) : null}

      {loadFailed ? (
        <p className="banner banner--error" role="alert">
          {t('roles.errors.loadFailed')}
        </p>
      ) : roles === null || catalog === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : (
        <>
          {canManage ? (
            <p>
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => openEditor({ mode: 'create' })}
              >
                {t('roles.create')}
              </button>
            </p>
          ) : null}

          <table className="table">
            <thead>
              <tr>
                <th>{t('roles.columns.name')}</th>
                <th>{t('roles.columns.type')}</th>
                <th>{t('roles.columns.permissions')}</th>
                <th>{t('roles.columns.assignedAdmins')}</th>
                <th>{t('roles.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const editable = canManage && !isImmutable(role);
                return (
                  <tr key={role.id}>
                    <td>{role.name}</td>
                    <td>{role.isSystem ? t('roles.system') : t('roles.custom')}</td>
                    <td>{role.permissions.length}</td>
                    <td>{role.assignedAdminCount}</td>
                    <td>
                      <span className="table__actions">
                        {editable ? (
                          <button
                            className="btn"
                            type="button"
                            onClick={() => openEditor({ mode: 'edit', role })}
                          >
                            {t('roles.edit')}
                          </button>
                        ) : (
                          <button
                            className="btn"
                            type="button"
                            onClick={() => openEditor({ mode: 'view', role })}
                          >
                            {t('roles.view')}
                          </button>
                        )}
                        {canManage && !role.isSystem ? (
                          confirmingDeleteId === role.id ? (
                            <span className="table__confirm">
                              {t('roles.deleteConfirm')}
                              <button
                                className="btn btn--danger"
                                type="button"
                                onClick={() => void handleDelete(role)}
                              >
                                {t('common.confirm')}
                              </button>
                              <button
                                className="btn"
                                type="button"
                                onClick={() => setConfirmingDeleteId(null)}
                              >
                                {t('common.cancel')}
                              </button>
                            </span>
                          ) : (
                            <button
                              className="btn"
                              type="button"
                              onClick={() => setConfirmingDeleteId(role.id)}
                            >
                              {t('roles.delete')}
                            </button>
                          )
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {editorOpen ? (
            <form className="card panel" onSubmit={(event) => void handleSave(event)}>
              <h2 className="panel__title">
                {editor.mode === 'create'
                  ? t('roles.builderCreateTitle')
                  : editor.mode === 'edit'
                    ? t('roles.builderEditTitle', { name: editor.role.name })
                    : t('roles.builderViewTitle', { name: editor.role.name })}
              </h2>
              {editor.mode === 'view' ? (
                <p className="panel__hint">{t('roles.immutableHint')}</p>
              ) : null}
              {editorError ? (
                <p className="banner banner--error" role="alert">
                  {t(editorError)}
                </p>
              ) : null}

              <div className="form-field">
                <label htmlFor="role-name">{t('roles.nameLabel')}</label>
                <input
                  id="role-name"
                  value={roleName}
                  onChange={(event) => setRoleName(event.target.value)}
                  maxLength={50}
                  required
                  // System roles keep their seeded name (RBAC-04).
                  disabled={
                    readOnly || submitting || (editor.mode === 'edit' && editor.role.isSystem)
                  }
                />
                {editor.mode === 'edit' && editor.role.isSystem ? (
                  <span className="panel__hint">{t('roles.systemNameHint')}</span>
                ) : null}
              </div>

              <fieldset className="checklist" disabled={readOnly || submitting}>
                <legend>{t('roles.permissionsLegend')}</legend>
                {domains.map((group) => (
                  <div key={group.domain} className="checklist__group">
                    <h3 className="checklist__domain">
                      {t(`permissionDomains.${group.domain}`, { defaultValue: group.domain })}
                    </h3>
                    {group.permissions.map((permission) => (
                      <label key={permission.code} className="checklist__item">
                        <input
                          type="checkbox"
                          checked={selected.has(permission.code)}
                          onChange={() => toggle(permission.code)}
                        />
                        <span>{permissionLabel(permission.code)}</span>
                        <code dir="ltr">{permission.code}</code>
                      </label>
                    ))}
                  </div>
                ))}
              </fieldset>

              <div className="panel__row">
                {!readOnly ? (
                  <button className="btn btn--primary" type="submit" disabled={submitting}>
                    {submitting ? t('roles.saving') : t('roles.save')}
                  </button>
                ) : null}
                <button
                  className="btn"
                  type="button"
                  onClick={() => setEditor({ mode: 'closed' })}
                  disabled={submitting}
                >
                  {readOnly ? t('common.close') : t('common.cancel')}
                </button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}
