/**
 * Android shows one runtime-permission dialog at a time and silently drops a
 * second concurrent request, so every prompt is serialized.
 */
import * as Location from 'expo-location';

import { requestLocationPermission } from '../../location/location-permission';
import { runExclusive } from '../permission-queue';

const locationMock = Location as jest.Mocked<typeof Location>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

describe('permission queue', () => {
  it('runs two concurrent prompts one after the other', async () => {
    const events: string[] = [];
    const first = deferred<string>();
    const second = deferred<string>();

    const a = runExclusive(() => {
      events.push('first:start');
      return first.promise;
    });
    const b = runExclusive(() => {
      events.push('second:start');
      return second.promise;
    });

    await flush();
    expect(events).toEqual(['first:start']);

    first.resolve('a');
    await expect(a).resolves.toBe('a');
    await flush();
    expect(events).toEqual(['first:start', 'second:start']);

    second.resolve('b');
    await expect(b).resolves.toBe('b');
  });

  it('starts the next prompt even when the previous one fails', async () => {
    const failing = runExclusive(() => Promise.reject(new Error('boom')));
    const next = runExclusive(async () => 'ok');

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('holds another prompt until the location prompt is answered', async () => {
    const location = deferred<Location.LocationPermissionResponse>();
    locationMock.requestForegroundPermissionsAsync.mockReturnValueOnce(location.promise);
    const notificationPrompt = jest.fn(async () => ({ granted: true }));

    const locationAnswer = requestLocationPermission();
    // Single-flight: a second caller shares the same prompt.
    expect(requestLocationPermission()).toBe(locationAnswer);
    const notificationAnswer = runExclusive(notificationPrompt);

    await flush();
    expect(locationMock.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(notificationPrompt).not.toHaveBeenCalled();

    location.resolve({ granted: true } as Location.LocationPermissionResponse);
    await locationAnswer;
    await expect(notificationAnswer).resolves.toEqual({ granted: true });
    expect(notificationPrompt).toHaveBeenCalledTimes(1);
  });
});
