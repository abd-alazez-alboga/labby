import { useTranslation } from 'react-i18next';

import { usePermissions } from '../../auth/usePermissions';

/**
 * For compact region filter selects (V1 audit I101): the "needs regions:view"
 * hint as a tooltip — undefined when the admin holds the permission.
 */
export function useRegionsViewTitle(): string | undefined {
  const { t } = useTranslation();
  const { can } = usePermissions();
  return can('regions:view') ? undefined : t('common.needsRegionsView');
}
