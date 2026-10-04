import '@testing-library/jest-dom/vitest';

import { initI18n } from '../i18n/i18n';

// Boot i18n once for the whole test run (mirrors the real boot sequence).
await initI18n();
