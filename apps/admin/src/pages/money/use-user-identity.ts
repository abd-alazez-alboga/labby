import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getUserTrust, type AdminUserTrust } from '../../api/trust';
import { useAuth } from '../../auth/AuthContext';
import { usePermissions } from '../../auth/usePermissions';

/**
 * Who a wallet / ledger page is about (V1 audit I79, I80): name, roles and
 * account state from the trust profile (`users:view`), so the header names
 * the person on a cold load instead of a raw UUID. Best effort — null without
 * the permission or on failure. The contract exposes no phone here (gap).
 */
export function useUserIdentity(userId: string): {
  identity: AdminUserTrust | null;
  /** "Rider · active" — the board's sub-line; null until loaded. */
  summary: string | null;
} {
  const { t } = useTranslation();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canUsers = can('users:view');
  const [identity, setIdentity] = useState<AdminUserTrust | null>(null);

  useEffect(() => {
    setIdentity(null);
    if (!canUsers || !userId) {
      return;
    }
    let cancelled = false;
    getUserTrust(apiClient, userId)
      .then((loaded) => {
        if (!cancelled) {
          setIdentity(loaded);
        }
      })
      .catch(() => {
        // The header falls back to the passed name / the ID.
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, userId, canUsers]);

  const summary = identity
    ? [
        identity.roles.map((role) => t(`money.identity.role.${role.role}`)).join(', '),
        t(`money.identity.state.${identity.accountState}`),
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  return { identity, summary };
}
