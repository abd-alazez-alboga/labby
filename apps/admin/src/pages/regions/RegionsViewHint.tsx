import { useTranslation } from 'react-i18next';

import { usePermissions } from '../../auth/usePermissions';

/**
 * Says why a region picker is empty: the region list (GET /admin/regions)
 * needs `regions:view`, which a custom role may lack (V1 audit I101). Renders
 * nothing when the admin holds it.
 */
export function RegionsViewHint() {
  const { t } = useTranslation();
  const { can } = usePermissions();
  return can('regions:view') ? null : <p className="panel__hint">{t('common.needsRegionsView')}</p>;
}
