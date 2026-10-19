import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { listAdminTickets } from '../api/support';
import { listAccountFlags, listAdminReports } from '../api/trust';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';

/**
 * Open-item counts for the Reports / Flagged accounts menu badges, read
 * from the queues' own list endpoints (one 1-item page each: `totalElements`)
 * — no dedicated count endpoint. Refreshed on every navigation, so a
 * resolution shows up as soon as the admin moves on. Null = unknown.
 */
export function useTrustQueueCounts(): {
  reports: number | null;
  flags: number | null;
  support: number | null;
} {
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const { pathname } = useLocation();
  const canReports = can('reports:view');
  const canFlags = can('users:view');
  const canSupport = can('support:view');
  const [reports, setReports] = useState<number | null>(null);
  const [flags, setFlags] = useState<number | null>(null);
  const [support, setSupport] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (canReports) {
      listAdminReports(apiClient, { status: 'open', size: 1 })
        .then((page) => !cancelled && setReports(page.totalElements))
        .catch(() => !cancelled && setReports(null));
    } else {
      setReports(null);
    }
    if (canFlags) {
      listAccountFlags(apiClient, { status: 'open', size: 1 })
        .then((page) => !cancelled && setFlags(page.totalElements))
        .catch(() => !cancelled && setFlags(null));
    } else {
      setFlags(null);
    }
    if (canSupport) {
      // The M14 ticket queue's default filter = every non-closed ticket.
      listAdminTickets(apiClient, { size: 1 })
        .then((page) => !cancelled && setSupport(page.totalItems))
        .catch(() => !cancelled && setSupport(null));
    } else {
      setSupport(null);
    }
    return () => {
      cancelled = true;
    };
  }, [apiClient, canReports, canFlags, canSupport, pathname]);

  return { reports, flags, support };
}
