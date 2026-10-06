import { describe, expect, it } from 'vitest';

import {
  deepLinkFromPushData,
  deepLinkToPath,
  NOTIFICATION_CENTER_PATH,
} from '../notifications/deep-links';

/** UC-S-11: catalog screens → admin routes; anything unmapped opens the center. */
describe('admin deep-link mapper', () => {
  it('maps the center screen to the center', () => {
    expect(deepLinkToPath({ screen: 'notifications' })).toBe(NOTIFICATION_CENTER_PATH);
  });

  it('opens the center for a missing link', () => {
    expect(deepLinkToPath(null)).toBe(NOTIFICATION_CENTER_PATH);
    expect(deepLinkToPath(undefined)).toBe(NOTIFICATION_CENTER_PATH);
  });

  it('opens the center for driver-app screens, which have no admin counterpart', () => {
    for (const screen of ['driver_application', 'driver_documents', 'driver_vehicles']) {
      expect(deepLinkToPath({ screen, params: { documentType: 'insurance' } })).toBe(
        NOTIFICATION_CENTER_PATH,
      );
    }
  });

  it('opens the center for unknown or future screens (contract rule)', () => {
    expect(deepLinkToPath({ screen: 'ride', params: { rideId: 'r-1' } })).toBe(
      NOTIFICATION_CENTER_PATH,
    );
    expect(deepLinkToPath({ screen: 'no_such_screen' })).toBe(NOTIFICATION_CENTER_PATH);
    expect(deepLinkToPath({ screen: 'toString' })).toBe(NOTIFICATION_CENTER_PATH);
  });
});

/** realtime-v1 push payload: data.screen + data.params (JSON object as a string). */
describe('deep link from a push data map', () => {
  it('reads screen and params', () => {
    expect(
      deepLinkFromPushData({ screen: 'driver_documents', params: '{"documentType":"insurance"}' }),
    ).toEqual({ screen: 'driver_documents', params: { documentType: 'insurance' } });
    expect(deepLinkFromPushData({ screen: 'notifications' })).toEqual({
      screen: 'notifications',
      params: {},
    });
  });

  it('has no link without a screen', () => {
    expect(deepLinkFromPushData({ notificationId: 'n1', category: 'account' })).toBeNull();
  });

  it('drops malformed or non-string params instead of failing', () => {
    expect(deepLinkFromPushData({ screen: 'ride', params: 'not json' })).toEqual({
      screen: 'ride',
      params: {},
    });
    expect(deepLinkFromPushData({ screen: 'ride', params: '["x"]' })?.params).toEqual({});
    expect(
      deepLinkFromPushData({ screen: 'ride', params: '{"rideId":"r1","n":3}' })?.params,
    ).toEqual({ rideId: 'r1' });
  });
});
