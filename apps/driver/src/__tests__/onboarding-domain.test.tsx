/**
 * M5-T3 — onboarding domain helpers + i18n: private file URL resolution
 * (NFR-S2), draft validation, fieldErrors routing (E1), EN/AR key parity,
 * and the Arabic (RTL) wizard copy.
 */
import { renderRouter, screen } from 'expo-router/testing-library';

import { resolveFileUrl } from '../api/onboarding';
import { clearSession } from '../auth/session';
import { initI18n, setAppLanguage } from '../i18n';
import ar from '../i18n/translations/ar.json';
import en from '../i18n/translations/en.json';
import { isAfterToday, todayIso } from '../onboarding/dates';
import { emptyVehicle, toVehicleInput, validateVehicleDetails } from '../onboarding/drafts';
import { messageKeyFor, targetOf } from '../onboarding/server-errors';
import { installContractFetch, riderOnlyUser, seedSession } from '../test-utils/contract';

function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('onboarding domain', () => {
  it('resolves API-relative file URLs against the API base and keeps absolute ones', () => {
    expect(resolveFileUrl('/api/v1/files/abc')).toBe('http://localhost:8080/api/v1/files/abc');
    expect(resolveFileUrl('https://cdn.example/files/x?sig=1')).toBe(
      'https://cdn.example/files/x?sig=1',
    );
  });

  it('treats only dates strictly after today as valid (E2)', () => {
    const now = new Date(2026, 9, 6, 23, 30);
    expect(todayIso(now)).toBe('2026-10-06');
    expect(isAfterToday('2026-10-06', now)).toBe(false);
    expect(isAfterToday('2026-10-07', now)).toBe(true);
  });

  it('validates the vehicle bounds and normalises Arabic-Indic digits', () => {
    const now = new Date(2026, 0, 1);
    const draft = {
      ...emptyVehicle(),
      make: 'Kia',
      model: 'Rio',
      color: 'White',
      plate: 'X',
      year: '٢٠٢٧',
      seats: '۸',
    };
    expect(validateVehicleDetails(draft, now)).toEqual({});
    expect(validateVehicleDetails({ ...draft, year: '2028' }, now)).toEqual({
      year: 'onboarding.validation.year',
    });
    expect(validateVehicleDetails({ ...draft, seats: '0' }, now)).toEqual({
      seats: 'onboarding.validation.seats',
    });
    expect(toVehicleInput(draft)).toMatchObject({ year: 2027, seats: 8 });
  });

  it('routes contract fieldErrors keys to their step', () => {
    expect(targetOf('documents[insurance].expiresOn')).toEqual({
      step: 'document',
      type: 'insurance',
    });
    expect(targetOf('vehicle.photoFileIds')).toEqual({ step: 'photos' });
    expect(targetOf('vehicle.plate')).toEqual({ step: 'vehicle' });
    expect(targetOf('profilePhoto')).toEqual({ step: 'personal' });
    expect(targetOf('something')).toEqual({ step: 'unknown' });
    expect(messageKeyFor('documents[insurance].expiresOn')).toBe('onboarding.server.expiresOn');
    expect(messageKeyFor('documents[insurance]')).toBe('onboarding.server.generic');
  });

  it('keeps EN and AR translation keys in parity', () => {
    expect(keysOf(ar).sort()).toEqual(keysOf(en).sort());
  });
});

describe('onboarding in Arabic (RTL)', () => {
  beforeEach(async () => {
    await clearSession();
    await initI18n();
  });

  afterEach(async () => {
    await setAppLanguage('en');
  });

  it('renders the wizard copy in Arabic with the لبي brand on the gate', async () => {
    await setAppLanguage('ar');
    const user = riderOnlyUser({ language: 'ar', photoUrl: '/api/v1/files/p' });
    await seedSession(user);
    installContractFetch({
      'GET /api/v1/users/me': { status: 200, body: user },
      'GET /api/v1/driver/application': { status: 404, body: { status: 404 } },
    });
    const view = renderRouter('src/app');

    await screen.findByTestId('gate-intro');
    expect(screen.getByTestId('gate-title')).toHaveTextContent('كن سائقاً في لبي');
    expect(screen.getByText('ابدأ طلبي')).toBeTruthy();
    // Unmount before afterEach switches the language back.
    view.unmount();
  });
});
