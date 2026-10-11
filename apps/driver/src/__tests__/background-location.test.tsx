/**
 * M6-X2 — background location (TRK-01 "whenever online"): the task forwards
 * fixes to the streamer oldest-first; the driver source streams in the
 * background when the build supports it and "Allow all the time" is granted,
 * and otherwise falls back to the foreground watch (Expo Go, refusal, a
 * failed service start) — owner decision 2026-10-08: a refusing driver stays
 * online foreground-only and sees a persistent warning with a settings button.
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { Linking } from "react-native";

import { BackgroundLocationBanner } from "../components/availability/background-location-banner";
import { initI18n } from "../i18n";
// jest.mock calls below are hoisted above these imports; the task is defined at module load.
import {
  BACKGROUND_LOCATION_TASK,
  deliverBackgroundLocations,
  setBackgroundFixListener,
} from "../realtime/background-location-task";
import {
  driverLocationSource,
  getBackgroundLocationStatus,
} from "../realtime/location-source";
import type { GpsFix } from "../realtime/protocol";

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3, High: 4 },
  ActivityType: { AutomotiveNavigation: 2 },
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
}));
jest.mock("expo-task-manager", () => ({
  isAvailableAsync: jest.fn(),
  isTaskDefined: jest.fn(() => false),
  defineTask: jest.fn(),
}));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { executionEnvironment: "bare" },
  ExecutionEnvironment: { Bare: "bare", Standalone: "standalone", StoreClient: "storeClient" },
}));

const mockLocation = jest.requireMock("expo-location");
const mockTaskManager = jest.requireMock("expo-task-manager");
const mockConstants = jest.requireMock("expo-constants").default;
const definedTask = mockTaskManager.defineTask.mock.calls[0];

function fix(timestamp: number, lat = 33.5): GpsFix {
  return { coords: { latitude: lat, longitude: 36.3, accuracy: 5 }, timestamp };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Stops every source a test started, so the shared status starts idle. */
const stops: (() => void)[] = [];
async function startSource(onFix: (fix: GpsFix) => void = jest.fn()) {
  const stop = await driverLocationSource(5).start(onFix);
  stops.push(stop);
  return stop;
}

beforeAll(async () => {
  await initI18n();
});

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
});

beforeEach(() => {
  jest.clearAllMocks();
  mockConstants.executionEnvironment = "bare";
  mockTaskManager.isAvailableAsync.mockResolvedValue(true);
  mockLocation.getBackgroundPermissionsAsync.mockResolvedValue({
    granted: false,
    canAskAgain: true,
  });
  mockLocation.requestBackgroundPermissionsAsync.mockResolvedValue({ granted: true });
  mockLocation.startLocationUpdatesAsync.mockResolvedValue(undefined);
  mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
  mockLocation.stopLocationUpdatesAsync.mockResolvedValue(undefined);
  mockLocation.watchPositionAsync.mockResolvedValue({ remove: jest.fn() });
  setBackgroundFixListener(null);
});

describe("background location task", () => {
  it("is defined once at module load under its task name", () => {
    expect(definedTask[0]).toBe(BACKGROUND_LOCATION_TASK);
  });

  it("forwards a batched delivery oldest first; errors and no listener do nothing", async () => {
    const received: number[] = [];
    deliverBackgroundLocations({ locations: [fix(1)] }); // no listener yet
    setBackgroundFixListener((next) => received.push(next.timestamp));

    await definedTask[1]({ data: { locations: [fix(30), fix(10), fix(20)] }, error: null });
    await definedTask[1]({ data: { locations: [fix(40)] }, error: { message: "boom" } });
    deliverBackgroundLocations({ nothing: true });

    expect(received).toEqual([10, 20, 30]);
  });
});

describe("driverLocationSource", () => {
  it("streams in the background when supported and 'Allow all the time' is granted", async () => {
    const onFix = jest.fn();
    const stop = await startSource(onFix);

    expect(mockLocation.requestBackgroundPermissionsAsync).toHaveBeenCalled();
    expect(mockLocation.startLocationUpdatesAsync).toHaveBeenCalledWith(
      BACKGROUND_LOCATION_TASK,
      expect.objectContaining({
        timeInterval: 5000,
        distanceInterval: 0,
        // Owner-approved copy (2026-10-08), in the app language.
        foregroundService: expect.objectContaining({
          notificationTitle: "You're online",
          notificationBody: "Labby is sharing your location to find you rides.",
        }),
      }),
    );
    expect(mockLocation.watchPositionAsync).not.toHaveBeenCalled();
    expect(getBackgroundLocationStatus()).toBe("active");

    // Fixes from the OS task reach the streamer's callback.
    await definedTask[1]({ data: { locations: [fix(1), fix(2)] }, error: null });
    expect(onFix).toHaveBeenCalledTimes(2);

    stop();
    await flush();
    expect(mockLocation.stopLocationUpdatesAsync).toHaveBeenCalledWith(BACKGROUND_LOCATION_TASK);
    expect(getBackgroundLocationStatus()).toBe("idle");
    await definedTask[1]({ data: { locations: [fix(3)] }, error: null });
    expect(onFix).toHaveBeenCalledTimes(2); // nothing after going offline
  });

  it("does not prompt again when already granted", async () => {
    mockLocation.getBackgroundPermissionsAsync.mockResolvedValue({ granted: true });
    await startSource();
    expect(mockLocation.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockLocation.startLocationUpdatesAsync).toHaveBeenCalled();
  });

  it("falls back to the foreground watch when the driver refuses (status denied)", async () => {
    mockLocation.requestBackgroundPermissionsAsync.mockResolvedValue({ granted: false });
    const stop = await startSource();

    expect(mockLocation.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(mockLocation.watchPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ timeInterval: 5000, distanceInterval: 0 }),
      expect.any(Function),
    );
    expect(getBackgroundLocationStatus()).toBe("denied");
    stop();
    expect(getBackgroundLocationStatus()).toBe("idle");
  });

  it("never prompts when the OS says it cannot ask again", async () => {
    mockLocation.getBackgroundPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    });
    await startSource();
    expect(mockLocation.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(getBackgroundLocationStatus()).toBe("denied");
  });

  it("uses the foreground watch in Expo Go without asking (status unsupported)", async () => {
    mockConstants.executionEnvironment = "storeClient";
    await startSource();
    expect(mockLocation.getBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockLocation.watchPositionAsync).toHaveBeenCalled();
    expect(getBackgroundLocationStatus()).toBe("unsupported");
  });

  it("falls back to the foreground watch when the background service fails to start", async () => {
    mockLocation.startLocationUpdatesAsync.mockRejectedValue(new Error("service refused"));
    const onFix = jest.fn();
    await startSource(onFix);

    expect(mockLocation.watchPositionAsync).toHaveBeenCalled();
    expect(getBackgroundLocationStatus()).toBe("denied");
    await definedTask[1]({ data: { locations: [fix(1)] }, error: null });
    expect(onFix).not.toHaveBeenCalled(); // the failed task listener was cleared
  });
});

describe("BackgroundLocationBanner", () => {
  it("shows only while foreground-only after a refusal, and opens the settings", async () => {
    render(<BackgroundLocationBanner />);
    expect(screen.queryByTestId("background-location-banner")).toBeNull();

    mockLocation.requestBackgroundPermissionsAsync.mockResolvedValue({ granted: false });
    let stop: () => void = () => {};
    await act(async () => {
      stop = await startSource();
    });
    expect(screen.getByTestId("background-location-banner")).toBeTruthy();

    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    fireEvent.press(screen.getByTestId("background-location-settings"));
    expect(openSettings).toHaveBeenCalled();

    act(() => stop());
    expect(screen.queryByTestId("background-location-banner")).toBeNull();
  });
});
