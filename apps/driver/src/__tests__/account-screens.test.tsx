import * as ImagePicker from "expo-image-picker";
import { renderRouter, screen } from "expo-router/testing-library";
import { fireEvent, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { clearSession, getSession } from "../auth/session";
import { AuthProvider } from "../auth/AuthProvider";
import { ChangePasswordScreen } from "../components/account/change-password-screen";
import { ChangePhoneScreen } from "../components/account/change-phone-screen";
import { DeleteAccountScreen } from "../components/account/delete-account-screen";
import { ProfileEditScreen } from "../components/account/profile-edit-screen";
import i18n, { initI18n, setAppLanguage } from "../i18n";
import { LocaleProvider } from "../i18n/LocaleProvider";
import {
  driverUser,
  installContractFetch,
  seedSession,
} from "../test-utils/contract";

const mockRegisterThisDevice = jest.fn((_options?: { prompt?: boolean }) =>
  Promise.resolve(true),
);
jest.mock("../notifications/push", () => ({
  ...jest.requireActual("../notifications/push"),
  registerThisDevice: (options?: { prompt?: boolean }) =>
    mockRegisterThisDevice(options),
}));

function renderScreen(Component: React.ComponentType) {
  renderRouter(
    {
      index: () => (
        <LocaleProvider initialLanguage="en">
          <AuthProvider>
            <Component />
          </AuthProvider>
        </LocaleProvider>
      ),
    },
    { initialUrl: "/" },
  );
}

describe("account screens (UC-S-05/06/07/09/10)", () => {
  beforeEach(async () => {
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  describe("change password (2FA)", () => {
    it("requests the 2FA code, submits the contract body, and shows done", async () => {
      await seedSession(driverUser(), "1");
      const contract = installContractFetch({
        "POST /api/v1/users/me/2fa/request": { status: 204 },
        "PUT /api/v1/users/me/password": { status: 204 },
      });
      renderScreen(ChangePasswordScreen);

      fireEvent.changeText(
        screen.getByTestId("change-password-current"),
        "oldpass99",
      );
      fireEvent.press(screen.getByTestId("change-password-continue"));
      await screen.findByTestId("change-password-code-sent");
      expect(
        contract.requestsTo("POST /api/v1/users/me/2fa/request")[0].headers
          .Authorization,
      ).toBe("Bearer access-1");

      fireEvent.changeText(
        screen.getByTestId("change-password-code"),
        "123456",
      );
      fireEvent.press(screen.getByTestId("change-password-verify"));
      await screen.findByTestId("change-password-new");
      fireEvent.changeText(
        screen.getByTestId("change-password-new"),
        "newpass99",
      );
      fireEvent.changeText(
        screen.getByTestId("change-password-confirm"),
        "newpass99",
      );
      fireEvent.press(screen.getByTestId("change-password-submit"));

      await screen.findByTestId("change-password-done");
      expect(
        contract.requestsTo("PUT /api/v1/users/me/password")[0].body,
      ).toEqual({
        currentPassword: "oldpass99",
        otpCode: "123456",
        newPassword: "newpass99",
      });
      // The server drops the account's push tokens on a password change: re-register, never prompt.
      expect(mockRegisterThisDevice).toHaveBeenCalledWith({ prompt: false });
    });

    it("shows the wrong-password-or-code error on 400", async () => {
      await seedSession(driverUser(), "1");
      installContractFetch({
        "POST /api/v1/users/me/2fa/request": { status: 204 },
        "PUT /api/v1/users/me/password": {
          status: 400,
          body: { status: 400, message: "wrong" },
        },
      });
      renderScreen(ChangePasswordScreen);

      fireEvent.changeText(
        screen.getByTestId("change-password-current"),
        "oldpass99",
      );
      fireEvent.press(screen.getByTestId("change-password-continue"));
      await screen.findByTestId("change-password-code-sent");
      fireEvent.changeText(
        screen.getByTestId("change-password-code"),
        "000000",
      );
      fireEvent.press(screen.getByTestId("change-password-verify"));
      await screen.findByTestId("change-password-new");
      fireEvent.changeText(
        screen.getByTestId("change-password-new"),
        "newpass99",
      );
      fireEvent.changeText(
        screen.getByTestId("change-password-confirm"),
        "newpass99",
      );
      fireEvent.press(screen.getByTestId("change-password-submit"));

      await screen.findByTestId("change-password-error");
      expect(
        screen.getByText("Wrong current password or verification code."),
      ).toBeTruthy();

      fireEvent.press(screen.getByTestId("change-password-start-over"));
      expect(await screen.findByTestId("change-password-current")).toBeTruthy();
    });

    it("shows the rate-limit error when the 2FA request answers 429", async () => {
      await seedSession(driverUser(), "1");
      installContractFetch({
        "POST /api/v1/users/me/2fa/request": {
          status: 429,
          body: { status: 429, message: "cap" },
        },
      });
      renderScreen(ChangePasswordScreen);

      fireEvent.changeText(
        screen.getByTestId("change-password-current"),
        "oldpass99",
      );
      fireEvent.press(screen.getByTestId("change-password-continue"));
      await screen.findByTestId("change-password-error");
      expect(
        screen.getByText(
          "Too many codes requested. Please wait before trying again.",
        ),
      ).toBeTruthy();
    });

    it("forgot-password escape hatch signs out into the reset flow", async () => {
      await seedSession(driverUser(), "1");
      const contract = installContractFetch({
        "POST /api/v1/auth/logout": { status: 204 },
      });
      renderRouter(
        {
          index: () => (
            <LocaleProvider initialLanguage="en">
              <AuthProvider>
                <ChangePasswordScreen />
              </AuthProvider>
            </LocaleProvider>
          ),
          "forgot-password": () => <Text testID="forgot-route">reset</Text>,
        },
        { initialUrl: "/" },
      );

      fireEvent.press(screen.getByTestId("change-password-forgot"));

      expect(await screen.findByTestId("forgot-route")).toBeTruthy();
      await waitFor(() => expect(getSession()).toBeNull());
      expect(contract.requestsTo("POST /api/v1/auth/logout")).toHaveLength(1);
    });
  });

  describe("delete account (2FA, soft)", () => {
    it("shows the consequences, deletes with the OTP, and signs out locally", async () => {
      await seedSession(driverUser(), "1");
      const contract = installContractFetch({
        "POST /api/v1/users/me/2fa/request": { status: 204 },
        "DELETE /api/v1/users/me": { status: 204 },
      });
      renderScreen(DeleteAccountScreen);

      // Consequences copy (USR-07): retained data + reactivation.
      expect(screen.getByTestId("delete-consequences")).toBeTruthy();

      fireEvent.press(screen.getByTestId("delete-send-code"));
      await screen.findByTestId("delete-code-sent");

      fireEvent.changeText(screen.getByTestId("delete-code"), "123456");
      fireEvent.press(screen.getByTestId("delete-confirm"));

      await waitFor(() => expect(getSession()).toBeNull());
      expect(contract.requestsTo("DELETE /api/v1/users/me")[0].body).toEqual({
        otpCode: "123456",
      });
      // No logout call: the server already revoked all sessions.
      expect(contract.requestsTo("POST /api/v1/auth/logout")).toHaveLength(0);
    });

    it("stays signed in and shows the blocked error on 409", async () => {
      await seedSession(driverUser(), "1");
      installContractFetch({
        "DELETE /api/v1/users/me": {
          status: 409,
          body: { status: 409, message: "active ride" },
        },
      });
      renderScreen(DeleteAccountScreen);

      fireEvent.changeText(screen.getByTestId("delete-code"), "123456");
      fireEvent.press(screen.getByTestId("delete-confirm"));

      await screen.findByTestId("delete-error");
      expect(
        screen.getByText(
          "Your account cannot be deleted right now — finish any active ride and settle your balance first.",
        ),
      ).toBeTruthy();
      expect(getSession()).not.toBeNull();
    });

    it("shows the wrong-code error on 400", async () => {
      await seedSession(driverUser(), "1");
      installContractFetch({
        "DELETE /api/v1/users/me": {
          status: 400,
          body: { status: 400, message: "wrong otp" },
        },
      });
      renderScreen(DeleteAccountScreen);

      fireEvent.changeText(screen.getByTestId("delete-code"), "000000");
      fireEvent.press(screen.getByTestId("delete-confirm"));

      await screen.findByTestId("delete-error");
      expect(
        screen.getByText("Wrong or expired verification code."),
      ).toBeTruthy();
      expect(getSession()).not.toBeNull();
    });
  });

  describe("change phone (3 steps)", () => {
    it("walks new phone -> current-phone code -> new-phone code and updates the profile", async () => {
      const user = driverUser();
      await seedSession(user, "1");
      const updated = { ...user, phone: "+963900000777" };
      const contract = installContractFetch({
        "POST /api/v1/users/me/phone-change/start": { status: 204 },
        "POST /api/v1/users/me/phone-change/verify-current": { status: 204 },
        "POST /api/v1/users/me/phone-change/complete": {
          status: 200,
          body: updated,
        },
      });
      renderScreen(ChangePhoneScreen);

      fireEvent.changeText(
        screen.getByTestId("change-phone-new"),
        "+963900000777",
      );
      fireEvent.press(screen.getByTestId("change-phone-start"));
      await screen.findByTestId("change-phone-step-current-code");
      expect(
        contract.requestsTo("POST /api/v1/users/me/phone-change/start")[0].body,
      ).toEqual({ newPhone: "+963900000777" });

      fireEvent.changeText(
        screen.getByTestId("change-phone-current-code"),
        "111111",
      );
      fireEvent.press(screen.getByTestId("change-phone-verify-current"));
      await screen.findByTestId("change-phone-step-new-code");

      fireEvent.changeText(
        screen.getByTestId("change-phone-new-code"),
        "222222",
      );
      fireEvent.press(screen.getByTestId("change-phone-complete"));
      await screen.findByTestId("change-phone-step-done");

      // The cached profile now carries the new phone.
      expect(getSession()?.user.phone).toBe("+963900000777");
    });

    it("shows the already-in-use error on 409", async () => {
      await seedSession(driverUser(), "1");
      installContractFetch({
        "POST /api/v1/users/me/phone-change/start": {
          status: 409,
          body: { status: 409, message: "in use" },
        },
      });
      renderScreen(ChangePhoneScreen);

      fireEvent.changeText(
        screen.getByTestId("change-phone-new"),
        "+963900000777",
      );
      fireEvent.press(screen.getByTestId("change-phone-start"));

      await screen.findByTestId("change-phone-error");
      expect(
        screen.getByText("That phone number is already in use."),
      ).toBeTruthy();
    });

    it("restarts the whole flow on 410 at the verify step", async () => {
      await seedSession(driverUser(), "1");
      installContractFetch({
        "POST /api/v1/users/me/phone-change/start": { status: 204 },
        "POST /api/v1/users/me/phone-change/verify-current": {
          status: 410,
          body: { status: 410, message: "expired" },
        },
      });
      renderScreen(ChangePhoneScreen);

      fireEvent.changeText(
        screen.getByTestId("change-phone-new"),
        "+963900000777",
      );
      fireEvent.press(screen.getByTestId("change-phone-start"));
      await screen.findByTestId("change-phone-step-current-code");

      fireEvent.changeText(
        screen.getByTestId("change-phone-current-code"),
        "111111",
      );
      fireEvent.press(screen.getByTestId("change-phone-verify-current"));

      // Back at step 1 with the restart explanation.
      await screen.findByTestId("change-phone-step-new-phone");
      expect(
        screen.getByText(
          "The code expired or was tried too many times. Start the phone change again.",
        ),
      ).toBeTruthy();
    });
  });

  describe("profile edit (name/language/photo)", () => {
    it("saves name + language through the contract and applies the language locally", async () => {
      const user = driverUser();
      await seedSession(user, "1");
      const updated = {
        ...user,
        name: "Updated Name",
        language: "ar" as const,
      };
      const contract = installContractFetch({
        "PUT /api/v1/users/me": { status: 200, body: updated },
      });
      renderScreen(ProfileEditScreen);

      fireEvent.changeText(screen.getByTestId("profile-name"), "Updated Name");
      fireEvent.press(screen.getByTestId("profile-language-ar"));
      fireEvent.press(screen.getByTestId("profile-save"));

      await screen.findByTestId("profile-info");
      expect(contract.requestsTo("PUT /api/v1/users/me")[0].body).toEqual({
        name: "Updated Name",
        language: "ar",
      });
      expect(getSession()?.user.name).toBe("Updated Name");
      // Account language is applied to the app too (UC-S-10).
      await waitFor(() => expect(i18n.language).toBe("ar"));
    });

    it("uploads a picked photo as multipart and refreshes the cached profile", async () => {
      const user = driverUser();
      await seedSession(user, "1");
      const updated = {
        ...user,
        photoUrl: "https://api.example/photos/me.jpg",
      };
      const contract = installContractFetch({
        "PUT /api/v1/users/me/photo": { status: 200, body: updated },
      });
      jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
        canceled: false,
        assets: [
          {
            uri: "file:///tmp/photo.jpg",
            fileName: "photo.jpg",
            mimeType: "image/jpeg",
            width: 100,
            height: 100,
          },
        ],
      } as Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>);
      renderScreen(ProfileEditScreen);

      fireEvent.press(screen.getByTestId("profile-choose-photo"));

      await screen.findByTestId("profile-info");
      const upload = contract.requestsTo("PUT /api/v1/users/me/photo")[0];
      expect(upload.body).toBeInstanceOf(FormData);
      // No JSON content type — fetch sets the multipart boundary itself.
      expect(upload.headers["Content-Type"]).toBeUndefined();
      expect(upload.headers.Authorization).toBe("Bearer access-1");
      expect(getSession()?.user.photoUrl).toBe(
        "https://api.example/photos/me.jpg",
      );
    });

    it("shows the unsupported-image error on 400", async () => {
      await seedSession(driverUser(), "1");
      installContractFetch({
        "PUT /api/v1/users/me/photo": {
          status: 400,
          body: { status: 400, message: "too big" },
        },
      });
      jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
        canceled: false,
        assets: [
          {
            uri: "file:///tmp/huge.bmp",
            fileName: "huge.bmp",
            mimeType: "image/bmp",
            width: 9000,
            height: 9000,
          },
        ],
      } as Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>);
      renderScreen(ProfileEditScreen);

      fireEvent.press(screen.getByTestId("profile-choose-photo"));

      await screen.findByTestId("profile-error");
      expect(
        screen.getByText(
          "That image cannot be used (unsupported type or size). Try another one.",
        ),
      ).toBeTruthy();
    });
  });
});
