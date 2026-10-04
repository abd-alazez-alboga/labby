import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createApiClient } from '../api/client';
import { getMeta, type ApiMeta } from '../api/meta';
import { useConfig } from '../config/ConfigContext';

type ApiStatusState = { kind: 'loading' } | { kind: 'ok'; meta: ApiMeta } | { kind: 'offline' };

/**
 * Shows the backend's live name/version fetched on mount, or a friendly
 * offline badge when the API is unreachable. Never throws — a dead backend
 * must not take the shell down with it.
 */
export function ApiStatus() {
  const { t } = useTranslation();
  const config = useConfig();
  const client = useMemo(() => createApiClient(config), [config]);
  const [state, setState] = useState<ApiStatusState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getMeta(client)
      .then((meta) => {
        if (!cancelled) setState({ kind: 'ok', meta });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'offline' });
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (state.kind === 'loading') {
    return <div className="api-status api-status--loading">{t('api.checking')}</div>;
  }
  if (state.kind === 'offline') {
    return <div className="api-status api-status--offline">{t('api.offline')}</div>;
  }
  return (
    <div className="api-status api-status--ok">
      {t('api.version', { version: state.meta.version })}
    </div>
  );
}
