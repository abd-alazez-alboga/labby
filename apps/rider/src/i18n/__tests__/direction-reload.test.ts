/**
 * Direction-changing language switches reload the app (owner decision
 * 2026-10-07) and reopen the screen the switch happened on, once.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { reloadAppAsync } from "expo";

import { reloadForDirection, takeReturnRoute } from "../direction-reload";

jest.mock("expo", () => ({ reloadAppAsync: jest.fn(async () => undefined) }));

describe("direction reload", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.mocked(reloadAppAsync).mockClear();
  });

  it("reloads and remembers the screen to return to, one time only", async () => {
    await expect(reloadForDirection("/settings")).resolves.toBe(true);
    expect(reloadAppAsync).toHaveBeenCalledTimes(1);
    await expect(takeReturnRoute()).resolves.toBe("/settings");
    await expect(takeReturnRoute()).resolves.toBeNull();
  });

  it("reports false when the host cannot reload", async () => {
    jest.mocked(reloadAppAsync).mockRejectedValueOnce(new Error("no host"));
    await expect(reloadForDirection()).resolves.toBe(false);
  });
});
