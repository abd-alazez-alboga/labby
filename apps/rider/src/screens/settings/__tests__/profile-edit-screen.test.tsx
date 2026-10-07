import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import React from "react";

import {
  mockApi,
  sampleUser,
  seedSignedInSession,
} from "../../../test-utils/mock-api";
import { renderWithProviders } from "../../../test-utils/render";
import ProfileEditScreen from "../profile-edit-screen";
import { reloadForDirection } from "../../../i18n/direction-reload";

jest.mock("../../../i18n/direction-reload", () => ({
  reloadForDirection: jest.fn(async () => true),
  takeReturnRoute: jest.fn(async () => null),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const mockLaunchImageLibraryAsync = jest.fn();
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) =>
    mockLaunchImageLibraryAsync(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

const UPDATE_ME = "PUT /api/v1/users/me";
const UPLOAD_PHOTO = "PUT /api/v1/users/me/photo";

describe("ProfileEditScreen (UC-S-09/10)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
    await seedSignedInSession();
  });

  it("saves name + language to the account", async () => {
    const api = mockApi({
      [UPDATE_ME]: {
        status: 200,
        body: { ...sampleUser, name: "Renamed Rider" },
      },
    });

    await renderWithProviders(<ProfileEditScreen />);
    expect(await screen.findByTestId("profile-edit-screen")).toBeOnTheScreen();

    await fireEvent.changeText(
      screen.getByTestId("profile-name"),
      "Renamed Rider",
    );
    await fireEvent.press(screen.getByTestId("profile-save"));

    expect(await screen.findByTestId("profile-saved")).toBeOnTheScreen();
    expect(api.callsTo("PUT", "/api/v1/users/me")[0].body).toEqual({
      name: "Renamed Rider",
      language: "en",
    });
  });

  it("applies a new language on save, then reloads for the new direction", async () => {
    mockApi({
      [UPDATE_ME]: {
        status: 200,
        body: { ...sampleUser, language: "ar" },
      },
    });

    await renderWithProviders(<ProfileEditScreen />);
    expect(await screen.findByTestId("profile-edit-screen")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("profile-language-ar"));
    // Not applied before the save (a reload would drop unsaved edits).
    expect(screen.queryByText("اللغة")).toBeNull();
    expect(reloadForDirection).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("profile-save"));

    expect(await screen.findByText("اللغة")).toBeOnTheScreen();
    await waitFor(() =>
      expect(reloadForDirection).toHaveBeenCalledWith("/settings"),
    );
  });

  it("uploads a picked photo as multipart and shows the result", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///tmp/photo.jpg",
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
        },
      ],
    });
    const api = mockApi({
      [UPLOAD_PHOTO]: {
        status: 200,
        body: {
          ...sampleUser,
          photoUrl: "https://cdn.labby.test/u/1/photo.jpg",
        },
      },
    });

    await renderWithProviders(<ProfileEditScreen />);
    expect(
      await screen.findByTestId("profile-photo-fallback"),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("profile-change-photo"));

    await waitFor(() => {
      expect(screen.getByTestId("profile-photo")).toBeOnTheScreen();
    });
    const upload = api.callsTo("PUT", "/api/v1/users/me/photo")[0];
    expect(upload.body).toBeInstanceOf(FormData);
    expect(upload.headers.Authorization).toBe("Bearer seed-access");
    // The JSON content type must NOT be forced onto the multipart request.
    expect(upload.headers["Content-Type"]).toBeUndefined();
  });

  it("shows a reason when the photo is rejected (400, UC-S-09 exception)", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///tmp/photo.gif",
          fileName: "photo.gif",
          mimeType: "image/gif",
        },
      ],
    });
    mockApi({
      [UPLOAD_PHOTO]: {
        status: 400,
        body: { status: 400, message: "Unsupported type" },
      },
    });

    await renderWithProviders(<ProfileEditScreen />);
    expect(await screen.findByTestId("profile-edit-screen")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("profile-change-photo"));

    expect(await screen.findByTestId("profile-photo-error")).toBeOnTheScreen();
    expect(screen.getByText("Unsupported type")).toBeOnTheScreen();
  });
});
