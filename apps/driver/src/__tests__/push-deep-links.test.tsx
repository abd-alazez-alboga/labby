/**
 * M6-T4 — push registration and deep links (UC-S-11, UC-S-25, NTF-01):
 * the catalog → route mapper, push payload parsing, device registration
 * after login (`PUT /devices {token, platform, app:'driver'}`), re-register
 * on FCM token rotation, `DELETE /devices/{token}` on logout (before the
 * session is revoked), graceful no-op in Expo Go / when denied, and
 * notification taps (warm + cold start) opening the right screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { renderRouter, screen } from 'expo-router/testing-library';
import { act, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { clearSession } from '../auth/session';
import { hrefForLink, parsePushPayload } from '../notifications/deep-links';
import {
  ANDROID_CHANNEL_ID,
  PUSH_TOKEN_STORAGE_KEY,
  registerThisDevice,
} from '../notifications/push';
import { PushBridge } from '../notifications/PushBridge';
import { runExclusive } from '../permissions/permission-queue';
import { driverUser, installContractFetch, riderOnlyUser, seedSession } from '../test-utils/contract';
import type { MockResponse } from '../test-utils/contract';
import { slotFixture } from '../test-utils/onboarding';

jest.mock('expo', () => ({
  ...jest.requireActual('expo'),
  isRunningInExpoGo: jest.fn(() => false),
}));

const expoMock = jest.requireMock('expo') as { isRunningInExpoGo: jest.Mock };
const notificationsMock = Notifications as jest.Mocked<typeof Notifications>;

type TapListener = (response: Notifications.NotificationResponse) => void;
type TokenListener = (token: Notifications.DevicePushToken) => void;

function tapResponse(data: Record<string, unknown>): Notifications.NotificationResponse {
  return {
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: {
      date: 0,
      request: {
        identifier: 'push-1',
        content: { title: 't', body: 'b', data } as Notifications.NotificationContent,
        trigger: null,
      },
    },
  } as unknown as Notifications.NotificationResponse;
}

function mockPush({ permission = 'granted' as 'granted' | 'denied' | 'undetermined' } = {}) {
  notificationsMock.getPermissionsAsync.mockResolvedValue({
    status: permission === 'undetermined' ? 'undetermined' : permission,
    granted: permission === 'granted',
    // A real (final) Android denial can no longer be asked again.
    canAskAgain: permission !== 'denied',
  } as Notifications.NotificationPermissionsStatus);
  notificationsMock.requestPermissionsAsync.mockResolvedValue({
    status: 'granted',
    granted: true,
  } as Notifications.NotificationPermissionsStatus);
  notificationsMock.getDevicePushTokenAsync.mockResolvedValue({
    type: 'ios',
    data: 'fcm-token-1',
  });
}

function SignOutButton() {
  const { signOut } = useAuth();
  return (
    <Pressable testID="test-sign-out" onPress={() => void signOut()}>
      <Text>sign out</Text>
    </Pressable>
  );
}

function renderWithBridge() {
  renderRouter(
    {
      _layout: () => {
        const { Slot } = jest.requireActual('expo-router');
        return (
          <AuthProvider>
            <Slot />
            <PushBridge />
            <SignOutButton />
          </AuthProvider>
        );
      },
      index: () => <View testID="home-route" />,
      documents: () => <View testID="documents-route" />,
      vehicles: () => <View testID="vehicles-route" />,
      notifications: () => <View testID="notifications-route" />,
      'apply-to-drive': () => <View testID="gate-route" />,
    },
    { initialUrl: '/' },
  );
}

async function flush() {
  await act(async () => {});
  await act(async () => {});
}

describe('deep-link mapper (UC-S-11)', () => {
  const driver = { isDriver: true };
  const applicant = { isDriver: false };

  it('maps every catalog screen to its route', () => {
    expect(hrefForLink({ screen: 'driver_application' }, applicant)).toBe('/apply-to-drive');
    expect(hrefForLink({ screen: 'driver_application' }, driver)).toBe('/');
    expect(hrefForLink({ screen: 'driver_documents' }, driver)).toBe('/documents');
    expect(
      hrefForLink({ screen: 'driver_documents', params: { documentType: 'insurance' } }, driver),
    ).toEqual({ pathname: '/documents', params: { documentType: 'insurance' } });
    expect(hrefForLink({ screen: 'driver_vehicles' }, driver)).toBe('/vehicles');
    expect(hrefForLink({ screen: 'notifications' }, driver)).toBe('/notifications');
  });

  it('falls back to the center for unknown screens, missing links and gated targets', () => {
    expect(hrefForLink({ screen: 'ride', params: { rideId: 'r1' } }, driver)).toBe(
      '/notifications',
    );
    expect(hrefForLink(null, driver)).toBe('/notifications');
    expect(hrefForLink(undefined, driver)).toBe('/notifications');
    // An applicant has no vehicles screen.
    expect(hrefForLink({ screen: 'driver_vehicles' }, applicant)).toBe('/notifications');
    // An unknown document type is not forwarded.
    expect(
      hrefForLink({ screen: 'driver_documents', params: { documentType: 'passport' } }, driver),
    ).toBe('/documents');
  });

  it('reads the link out of the shapes a push payload may carry', () => {
    expect(
      parsePushPayload({ screen: 'driver_documents', params: '{"documentType":"insurance"}' }),
    ).toEqual({
      link: { screen: 'driver_documents', params: { documentType: 'insurance' } },
      notificationId: null,
    });
    expect(
      parsePushPayload({
        link: '{"screen":"driver_vehicles","params":null}',
        notificationId: 'n-1',
      }),
    ).toEqual({ link: { screen: 'driver_vehicles', params: null }, notificationId: 'n-1' });
    expect(parsePushPayload({ link: { screen: 'notifications' } }).link).toEqual({
      screen: 'notifications',
      params: null,
    });
    expect(parsePushPayload(null)).toEqual({ link: null, notificationId: null });
    expect(parsePushPayload('garbage')).toEqual({ link: null, notificationId: null });
  });
});

describe('push registration + taps (UC-S-25)', () => {
  let tapListener: TapListener | null;
  let tokenListener: TokenListener | null;

  beforeEach(async () => {
    jest.clearAllMocks();
    tapListener = null;
    tokenListener = null;
    expoMock.isRunningInExpoGo.mockReturnValue(false);
    notificationsMock.addNotificationResponseReceivedListener.mockImplementation((listener) => {
      tapListener = listener;
      return { remove: jest.fn() };
    });
    notificationsMock.addPushTokenListener.mockImplementation((listener) => {
      tokenListener = listener;
      return { remove: jest.fn() };
    });
    notificationsMock.getLastNotificationResponseAsync.mockResolvedValue(null);
    await clearSession();
    await AsyncStorage.clear();
  });

  async function setup(
    routes: Record<string, MockResponse | MockResponse[]>,
    user = driverUser(),
  ) {
    await seedSession(user);
    const contract = installContractFetch(routes);
    renderWithBridge();
    await flush();
    return contract;
  }

  it('prompts when Android 13+ reports "denied" before ever asking (canAskAgain: true)', async () => {
    notificationsMock.getPermissionsAsync.mockResolvedValue({
      status: 'denied',
      granted: false,
      canAskAgain: true,
    } as Notifications.NotificationPermissionsStatus);
    notificationsMock.requestPermissionsAsync.mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
    } as Notifications.NotificationPermissionsStatus);
    notificationsMock.getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: 'fcm-a13' });
    await seedSession(driverUser());
    installContractFetch({ 'PUT /api/v1/devices': { status: 204 } });

    await expect(registerThisDevice()).resolves.toBe(true);
    expect(notificationsMock.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('creates the HIGH-importance Android channel before asking for permission', async () => {
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    try {
      mockPush({ permission: 'undetermined' });
      await seedSession(driverUser());
      installContractFetch({ 'PUT /api/v1/devices': { status: 204 } });

      await expect(registerThisDevice()).resolves.toBe(true);
      expect(notificationsMock.setNotificationChannelAsync).toHaveBeenCalledWith(
        ANDROID_CHANNEL_ID,
        expect.objectContaining({ importance: Notifications.AndroidImportance.HIGH }),
      );
      expect(ANDROID_CHANNEL_ID).toBe('default');
      expect(notificationsMock.setNotificationChannelAsync.mock.invocationCallOrder[0]).toBeLessThan(
        notificationsMock.requestPermissionsAsync.mock.invocationCallOrder[0],
      );
    } finally {
      Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    }
  });

  it('never prompts after a final denial (canAskAgain: false)', async () => {
    notificationsMock.getPermissionsAsync.mockResolvedValue({
      status: 'denied',
      granted: false,
      canAskAgain: false,
    } as Notifications.NotificationPermissionsStatus);

    await expect(registerThisDevice()).resolves.toBe(false);
    expect(notificationsMock.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('re-checks without prompting on foreground re-entry (no permission-dialog loop)', async () => {
    // The OS dialog backgrounds the app and a dismissed dialog stays "undetermined":
    // prompting on every foreground looped the dialog on a fresh Android install (M6-T5).
    mockPush({ permission: 'undetermined' });

    await expect(registerThisDevice({ prompt: false })).resolves.toBe(false);
    expect(notificationsMock.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('waits for an open location dialog before showing the notification prompt', async () => {
    // Android drops a permission request made while another dialog is up.
    mockPush({ permission: 'undetermined' });
    notificationsMock.getDevicePushTokenAsync.mockRejectedValueOnce(new Error('no token'));
    let closeLocationDialog!: () => void;
    const locationDialog = runExclusive(
      () => new Promise<void>((resolve) => (closeLocationDialog = resolve)),
    );

    const registering = registerThisDevice({ prompt: true });
    await flush();
    expect(notificationsMock.requestPermissionsAsync).not.toHaveBeenCalled();

    closeLocationDialog();
    await locationDialog;
    await expect(registering).resolves.toBe(false);
    expect(notificationsMock.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('asks permission and registers the native device token after login', async () => {
    mockPush({ permission: 'undetermined' });
    const contract = await setup({ 'PUT /api/v1/devices': { status: 204 } });

    expect(notificationsMock.requestPermissionsAsync).toHaveBeenCalled();
    expect(contract.requestsTo('PUT /api/v1/devices')).toHaveLength(1);
    expect(contract.requestsTo('PUT /api/v1/devices')[0].body).toEqual({
      token: 'fcm-token-1',
      platform: 'ios',
      app: 'driver',
    });
    expect(contract.requestsTo('PUT /api/v1/devices')[0].headers.Authorization).toBe(
      'Bearer access-1',
    );
    expect(await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY)).toBe('fcm-token-1');
  });

  it('registers applicants too (their application pushes target the driver app)', async () => {
    mockPush();
    const contract = await setup({ 'PUT /api/v1/devices': { status: 204 } }, riderOnlyUser());
    expect(contract.requestsTo('PUT /api/v1/devices')).toHaveLength(1);
  });

  it('re-registers when FCM rotates the token, and unregisters on logout before revoking', async () => {
    mockPush();
    const contract = await setup({
      'PUT /api/v1/devices': { status: 204 },
      'DELETE /api/v1/devices/fcm-token-2': { status: 204 },
      'POST /api/v1/auth/logout': { status: 204 },
    });

    await act(async () => {
      tokenListener?.({ type: 'ios', data: 'fcm-token-2' });
    });
    expect(contract.requestsTo('PUT /api/v1/devices')[1].body).toEqual({
      token: 'fcm-token-2',
      platform: 'ios',
      app: 'driver',
    });

    fireEvent.press(screen.getByTestId('test-sign-out'));
    await flush();

    const order = contract.requests.map((r) => `${r.method} ${r.path}`);
    expect(order).toContain('DELETE /api/v1/devices/fcm-token-2');
    expect(order.indexOf('DELETE /api/v1/devices/fcm-token-2')).toBeLessThan(
      order.indexOf('POST /api/v1/auth/logout'),
    );
    expect(await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('does nothing (and never crashes) when permission is denied', async () => {
    mockPush({ permission: 'denied' });
    const contract = await setup({});
    expect(notificationsMock.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(contract.requests).toHaveLength(0);
  });

  it('skips remote push in Expo Go gracefully', async () => {
    mockPush();
    expoMock.isRunningInExpoGo.mockReturnValue(true);
    const contract = await setup({});
    expect(notificationsMock.getPermissionsAsync).not.toHaveBeenCalled();
    expect(notificationsMock.addPushTokenListener).not.toHaveBeenCalled();
    expect(contract.requests).toHaveLength(0);
    expect(screen.getByTestId('home-route')).toBeTruthy();
  });

  it('opens the linked screen when a notification is tapped and marks it read', async () => {
    mockPush({ permission: 'denied' });
    const contract = await setup({ 'POST /api/v1/notifications/n-9/read': { status: 204 } });

    await act(async () => {
      tapListener?.(
        tapResponse({
          notificationId: 'n-9',
          screen: 'driver_documents',
          params: '{"documentType":"insurance"}',
        }),
      );
    });

    expect(await screen.findByTestId('documents-route')).toBeTruthy();
    expect(contract.requestsTo('POST /api/v1/notifications/n-9/read')).toHaveLength(1);
  });

  it('routes a cold-start tap, and an unknown screen to the center', async () => {
    mockPush({ permission: 'denied' });
    notificationsMock.getLastNotificationResponseAsync.mockResolvedValue(
      tapResponse({ link: { screen: 'driver_vehicles' } }),
    );
    await setup({});
    expect(await screen.findByTestId('vehicles-route')).toBeTruthy();

    await act(async () => {
      tapListener?.(tapResponse({ screen: 'ride', params: { rideId: 'r-1' } }));
    });
    expect(await screen.findByTestId('notifications-route')).toBeTruthy();
  });

  it('sends an applicant to the application tracker', async () => {
    mockPush({ permission: 'denied' });
    await setup({}, riderOnlyUser());
    await act(async () => {
      tapListener?.(tapResponse({ screen: 'driver_application' }));
    });
    expect(await screen.findByTestId('gate-route')).toBeTruthy();
  });

  it('opens the real documents screen with the linked document highlighted', async () => {
    mockPush({ permission: 'denied' });
    const user = driverUser();
    await seedSession(user);
    installContractFetch({
      'GET /api/v1/users/me': { status: 200, body: user },
      'GET /api/v1/driver/documents': {
        status: 200,
        body: [
          slotFixture('government_id'),
          slotFixture('drivers_license'),
          slotFixture('vehicle_registration'),
          slotFixture('insurance'),
        ],
      },
    });
    renderRouter('src/app');
    expect(await screen.findByTestId('home-screen')).toBeTruthy();
    await flush();

    await act(async () => {
      tapListener?.(
        tapResponse({ screen: 'driver_documents', params: { documentType: 'insurance' } }),
      );
    });

    expect(await screen.findByTestId('slot-insurance-focused')).toBeTruthy();
    expect(screen.queryByTestId('slot-drivers_license-focused')).toBeNull();
  });
});
