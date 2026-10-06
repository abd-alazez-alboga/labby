/**
 * M4-T4 — region resolution (SD-01) against the regions-v1 contract:
 * boot resolve + cache, the significant-move threshold, boundary crossing,
 * the outside-operating-area state, network-failure fallback to the cache,
 * and the location-permission-denied state.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';

import type { RegionConfig } from '../../api/regions';
import { LocaleProvider } from '../../i18n/locale-context';
import { mockApi } from '../../test-utils/mock-api';
import HomeScreen from '../../screens/home-screen';
import { REGION_CACHE_KEY, RegionProvider } from '../region-context';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

const regionA: RegionConfig = {
  id: '0b54f3a8-9a90-4a62-8f10-aaaaaaaaaaaa',
  name: 'Damascus',
  currency: 'SYP',
  emergencyNumber: '112',
  serviceTypes: [
    {
      id: '3f1c5b1e-6d7a-4f00-9e1a-bbbbbbbbbbbb',
      regionId: '0b54f3a8-9a90-4a62-8f10-aaaaaaaaaaaa',
      nameEn: 'Economy',
      nameAr: 'اقتصادي',
      baseFare: 1,
      perKmRate: 0.5,
      perMinRate: 0.1,
      minimumFare: 1.5,
      enabled: true,
    },
  ],
};

const regionB: RegionConfig = {
  ...regionA,
  id: '0b54f3a8-9a90-4a62-8f10-cccccccccccc',
  name: 'Homs',
  currency: 'SYP',
};

// Inside region A, inside region B (~145 km away), and a <1.5 km nudge.
const pointA = { lat: 33.5, lng: 36.3 };
const pointB = { lat: 34.8, lng: 36.6 };
const nearPointA = { lat: 33.505, lng: 36.3 };

type WatchCallback = (position: { coords: { latitude: number; longitude: number } }) => void;

const locationMock = Location as jest.Mocked<typeof Location>;
// Every position subscriber (the region watch AND the home map's own
// position watch, M6-T4) — a simulated move is delivered to all of them.
let watchCallbacks: WatchCallback[] = [];

function mockLocation({ granted, at }: { granted: boolean; at?: { lat: number; lng: number } }) {
  locationMock.requestForegroundPermissionsAsync.mockResolvedValue({
    granted,
    status: (granted ? 'granted' : 'denied') as Location.PermissionStatus,
    canAskAgain: true,
    expires: 'never',
  });
  locationMock.getForegroundPermissionsAsync.mockResolvedValue({
    granted,
    status: (granted ? 'granted' : 'denied') as Location.PermissionStatus,
    canAskAgain: true,
    expires: 'never',
  });
  if (at) {
    locationMock.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: at.lat, longitude: at.lng },
    } as Location.LocationObject);
  }
  locationMock.watchPositionAsync.mockImplementation(async (_options, callback) => {
    watchCallbacks.push(callback as WatchCallback);
    return { remove: jest.fn() } as unknown as Location.LocationSubscription;
  });
}

function renderHome() {
  return render(
    <LocaleProvider>
      <RegionProvider>
        <HomeScreen />
      </RegionProvider>
    </LocaleProvider>,
  );
}

async function moveTo(point: { lat: number; lng: number }) {
  // Both the region watch and the home map watch are subscribed.
  await waitFor(() => expect(watchCallbacks.length).toBeGreaterThanOrEqual(2));
  await act(async () => {
    for (const callback of watchCallbacks) {
      callback({ coords: { latitude: point.lat, longitude: point.lng } });
    }
  });
}

describe('region resolution (M4-T4, SD-01)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    watchCallbacks = [];
    await AsyncStorage.clear();
  });

  it('resolves the region on boot, shows it on home, and caches the config', async () => {
    mockLocation({ granted: true, at: pointA });
    const api = mockApi({
      'GET /api/v1/regions/resolve': { status: 200, body: regionA },
    });

    await renderHome();

    expect(await screen.findByTestId('region-badge')).toHaveTextContent('Damascus · SYP');
    expect(api.callsTo('GET', '/api/v1/regions/resolve')[0].query).toEqual({
      lat: '33.5',
      lng: '36.3',
    });
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(REGION_CACHE_KEY);
      expect(JSON.parse(raw ?? 'null')).toMatchObject({
        config: { id: regionA.id, currency: 'SYP' },
        lat: pointA.lat,
        lng: pointA.lng,
      });
    });
  });

  it('re-resolves only past the significant-move threshold and switches config across a boundary', async () => {
    mockLocation({ granted: true, at: pointA });
    const api = mockApi({
      'GET /api/v1/regions/resolve': [
        { status: 200, body: regionA },
        { status: 200, body: regionB },
      ],
    });

    await renderHome();
    expect(await screen.findByTestId('region-badge')).toHaveTextContent('Damascus · SYP');

    // A < 1.5 km nudge is not significant — no second resolve call.
    await moveTo(nearPointA);
    expect(api.callsTo('GET', '/api/v1/regions/resolve')).toHaveLength(1);
    expect(screen.getByTestId('region-badge')).toHaveTextContent('Damascus · SYP');

    // Crossing into region B re-resolves and switches the stored config.
    await moveTo(pointB);
    await waitFor(() => {
      expect(screen.getByTestId('region-badge')).toHaveTextContent('Homs · SYP');
    });
    expect(api.callsTo('GET', '/api/v1/regions/resolve')).toHaveLength(2);
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(REGION_CACHE_KEY);
      expect(JSON.parse(raw ?? 'null')).toMatchObject({ config: { id: regionB.id } });
    });
  });

  it('renders the outside-operating-area state on a 404 and recovers via retry', async () => {
    mockLocation({ granted: true, at: pointA });
    mockApi({
      'GET /api/v1/regions/resolve': [
        { status: 404, body: { status: 404, message: 'Outside every operating region' } },
        { status: 200, body: regionA },
      ],
    });

    await renderHome();

    expect(await screen.findByTestId('region-outside')).toBeOnTheScreen();
    expect(screen.getByText('Outside our service area')).toBeOnTheScreen();
    expect(screen.queryByText('Welcome to Labby')).toBeNull();

    await fireEvent.press(screen.getByTestId('region-retry'));
    expect(await screen.findByTestId('region-badge')).toHaveTextContent('Damascus · SYP');
  });

  it('keeps the cached config when the resolve call fails on the network', async () => {
    await AsyncStorage.setItem(
      REGION_CACHE_KEY,
      JSON.stringify({ config: regionA, lat: pointA.lat, lng: pointA.lng }),
    );
    mockLocation({ granted: true, at: pointB });
    mockApi({}); // resolve is unmocked → rejects like a network failure

    await renderHome();

    // Server trouble is NOT "outside the area": the last config stays usable.
    expect(await screen.findByTestId('region-badge')).toHaveTextContent('Damascus · SYP');
    expect(screen.queryByTestId('region-outside')).toBeNull();
    expect(screen.queryByTestId('region-error')).toBeNull();
  });

  it('shows the error/retry state when resolution fails with no cached config', async () => {
    mockLocation({ granted: true, at: pointA });
    mockApi({});

    await renderHome();

    expect(await screen.findByTestId('region-error')).toBeOnTheScreen();
    expect(screen.getByText("Couldn't check your area")).toBeOnTheScreen();
    expect(screen.getByTestId('region-retry')).toBeOnTheScreen();
    expect(screen.queryByTestId('region-outside')).toBeNull();
  });

  it('explains the permission-denied state with retry and open-settings actions', async () => {
    mockLocation({ granted: false });
    mockApi({});
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();

    await renderHome();

    expect(await screen.findByTestId('region-permissionDenied')).toBeOnTheScreen();
    expect(screen.getByText('Location needed')).toBeOnTheScreen();
    expect(screen.getByTestId('region-retry')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('region-open-settings'));
    expect(openSettings).toHaveBeenCalled();
  });
});
