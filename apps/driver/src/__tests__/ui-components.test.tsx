/**
 * Design-system UI kit (docs/design/design-system.md, "Mobile components"):
 * type families per locale, RTL mirroring, button disabled/busy states,
 * chip and banner tones, the GO button, map FAB badges and sheet insets.
 */
import { Ionicons } from "@expo/vector-icons";
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  AppText,
  Banner,
  BottomSheet,
  DestructiveTextButton,
  GoButton,
  ListRow,
  MapFab,
  OptionGroup,
  PrimaryButton,
  ScreenHeader,
  SecondaryButton,
  StatusChip,
  TextButton,
  TextField,
} from "../components/ui";
import { initI18n, setAppLanguage } from "../i18n";
import type { Language } from "../i18n";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { colors } from "../theme/tokens";

function inLocale(language: Language, children: React.ReactNode) {
  return <LocaleProvider initialLanguage={language}>{children}</LocaleProvider>;
}

function styleOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

function iconNames(): string[] {
  return screen
    .UNSAFE_getAllByType(Ionicons)
    .map((icon) => icon.props.name as string);
}

describe("UI kit", () => {
  beforeEach(async () => {
    await initI18n();
    await setAppLanguage("en");
  });

  describe("AppText", () => {
    it("maps weight to the Manrope family in English, aligned left", () => {
      render(
        inLocale(
          "en",
          <AppText variant="display" testID="t">
            Documents
          </AppText>,
        ),
      );
      expect(styleOf("t")).toMatchObject({
        fontFamily: "Manrope_800ExtraBold",
        fontSize: 32,
        textAlign: "left",
      });
      expect(styleOf("t").fontWeight).toBeUndefined();
    });

    it("uses IBM Plex Sans Arabic (800 → 700) right-aligned in Arabic", async () => {
      await setAppLanguage("ar");
      render(
        inLocale(
          "ar",
          <AppText variant="display" testID="t">
            المستندات
          </AppText>,
        ),
      );
      expect(styleOf("t")).toMatchObject({
        fontFamily: "IBMPlexSansArabic_700Bold",
        textAlign: "right",
      });
    });

    it("honours a fontWeight given in style", () => {
      render(
        inLocale(
          "en",
          <AppText style={{ fontWeight: "600" }} testID="t">
            x
          </AppText>,
        ),
      );
      expect(styleOf("t").fontFamily).toBe("Manrope_600SemiBold");
    });
  });

  describe("buttons", () => {
    it("primary: presses, and shows a spinner + blocks while busy", () => {
      const onPress = jest.fn();
      const { rerender } = render(
        inLocale(
          "en",
          <PrimaryButton title="Continue" onPress={onPress} testID="b" />,
        ),
      );
      fireEvent.press(screen.getByTestId("b"));
      expect(onPress).toHaveBeenCalledTimes(1);

      rerender(
        inLocale(
          "en",
          <PrimaryButton title="Continue" onPress={onPress} busy testID="b" />,
        ),
      );
      expect(screen.queryByText("Continue")).toBeNull();
      expect(screen.getByTestId("b")).toHaveProp("accessibilityState", {
        disabled: true,
        busy: true,
      });
      fireEvent.press(screen.getByTestId("b"));
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["secondary", SecondaryButton],
      ["text", TextButton],
      ["destructive", DestructiveTextButton],
    ] as const)(
      "%s: disabled blocks presses and reads as disabled",
      (_name, Button) => {
        const onPress = jest.fn();
        render(
          inLocale(
            "en",
            <Button title="Go" onPress={onPress} disabled testID="b" />,
          ),
        );
        fireEvent.press(screen.getByTestId("b"));
        expect(onPress).not.toHaveBeenCalled();
        expect(screen.getByTestId("b")).toBeDisabled();
      },
    );

    it("destructive text uses the danger colour", () => {
      render(
        inLocale(
          "en",
          <DestructiveTextButton title="Log out" onPress={() => {}} />,
        ),
      );
      expect(
        StyleSheet.flatten(screen.getByText("Log out").props.style).color,
      ).toBe(colors.danger);
    });
  });

  describe("StatusChip", () => {
    it.each([
      ["accent", colors.accentTint, colors.accent],
      ["success", colors.successBg, colors.success],
      ["warning", colors.warningBg, colors.warning],
      ["danger", colors.dangerBg, colors.danger],
      ["neutral", colors.surfaceFill, colors.textSecondary],
    ] as const)("%s tone", (tone, ground, ink) => {
      render(
        inLocale("en", <StatusChip label="Valid" tone={tone} testID="chip" />),
      );
      expect(styleOf("chip").backgroundColor).toBe(ground);
      expect(
        StyleSheet.flatten(screen.getByText("Valid").props.style).color,
      ).toBe(ink);
    });
  });

  describe("Banner", () => {
    it("carries title + message as its text content on the tone ground", () => {
      render(
        inLocale(
          "en",
          <Banner
            tone="warning"
            title="Heads up"
            message="Renew soon."
            testID="b"
          />,
        ),
      );
      expect(screen.getByTestId("b")).toHaveTextContent("Heads upRenew soon.");
      expect(
        StyleSheet.flatten(screen.getByText("Renew soon.").props.style).color,
      ).toBe(colors.warning);
    });
  });

  describe("ListRow", () => {
    it("shows a forward chevron and fires onPress in English", () => {
      const onPress = jest.fn();
      render(
        inLocale(
          "en",
          <ListRow
            title="Insurance"
            subtitle="Valid through 6 Oct 2027"
            chevron
            onPress={onPress}
            testID="row"
          />,
        ),
      );
      expect(iconNames()).toContain("chevron-forward");
      fireEvent.press(screen.getByTestId("row"));
      expect(onPress).toHaveBeenCalled();
    });

    it("mirrors in Arabic: back-pointing chevron, reversed row", async () => {
      await setAppLanguage("ar");
      render(
        inLocale(
          "ar",
          <ListRow title="التأمين" chevron onPress={() => {}} testID="row" />,
        ),
      );
      expect(iconNames()).toContain("chevron-back");
      expect(screen.getByText("التأمين")).toHaveStyle({ textAlign: "right" });
      // Native layout is still LTR in tests, so the row reverses by hand.
      const row = screen.getByTestId("row").children[0];
      if (typeof row === "string") throw new Error("expected the row view");
      const rowStyle = StyleSheet.flatten(row.props.style);
      expect(rowStyle).toMatchObject({ flexDirection: "row-reverse" });
    });

    it("disabled rows do not fire", () => {
      const onPress = jest.fn();
      render(
        inLocale(
          "en",
          <ListRow title="x" onPress={onPress} disabled testID="row" />,
        ),
      );
      fireEvent.press(screen.getByTestId("row"));
      expect(onPress).not.toHaveBeenCalled();
    });
  });

  describe("ScreenHeader", () => {
    it("shows the display title and a back chevron that flips in RTL", async () => {
      const onBack = jest.fn();
      render(
        inLocale("en", <ScreenHeader title="Documents" onBack={onBack} />),
      );
      expect(screen.getByText("Documents")).toHaveStyle({ fontSize: 32 });
      expect(iconNames()).toContain("chevron-back");
      fireEvent.press(screen.getByTestId("screen-back"));
      expect(onBack).toHaveBeenCalled();
      screen.unmount();

      await setAppLanguage("ar");
      render(
        inLocale("ar", <ScreenHeader title="المستندات" onBack={onBack} />),
      );
      expect(iconNames()).toContain("chevron-forward");
      expect(screen.getByTestId("screen-back")).toHaveProp(
        "accessibilityLabel",
        "رجوع",
      );
    });

    it("hides the back chevron with nowhere to go back to", () => {
      render(inLocale("en", <ScreenHeader title="Settings" />));
      expect(screen.queryByTestId("screen-back")).toBeNull();
    });
  });

  describe("TextField", () => {
    it("keeps the password eye toggle", () => {
      render(
        inLocale(
          "en",
          <TextField label="Password" secureTextEntry testID="pw" />,
        ),
      );
      expect(screen.getByTestId("pw")).toHaveProp("secureTextEntry", true);
      fireEvent.press(screen.getByTestId("pw-reveal"));
      expect(screen.getByTestId("pw")).toHaveProp("secureTextEntry", false);
      expect(screen.getByLabelText("Hide password")).toBeTruthy();
    });

    it("shows the error message", () => {
      render(
        inLocale(
          "en",
          <TextField label="Phone" error="Enter a valid number." testID="f" />,
        ),
      );
      expect(screen.getByText("Enter a valid number.")).toBeTruthy();
    });
  });

  describe("OptionGroup", () => {
    it("marks the selected option and reports changes", () => {
      const onChange = jest.fn();
      render(
        inLocale(
          "en",
          <OptionGroup
            options={["en", "ar"] as const}
            value="en"
            onChange={onChange}
            labelFor={(value) => value.toUpperCase()}
            testIDPrefix="lang"
          />,
        ),
      );
      expect(screen.getByTestId("lang-en")).toHaveProp("accessibilityState", {
        selected: true,
      });
      fireEvent.press(screen.getByTestId("lang-ar"));
      expect(onChange).toHaveBeenCalledWith("ar");
    });
  });

  describe("GoButton", () => {
    it("reads as the go-online switch and fires", () => {
      const onPress = jest.fn();
      render(
        inLocale(
          "en",
          <GoButton
            label="GO"
            accessibilityLabel="Go online"
            onPress={onPress}
            testID="go"
          />,
        ),
      );
      expect(screen.getByTestId("go")).toHaveTextContent("GO");
      expect(screen.getByTestId("go")).toHaveProp(
        "accessibilityRole",
        "switch",
      );
      fireEvent.press(screen.getByTestId("go"));
      expect(onPress).toHaveBeenCalled();
    });

    it("disabled: dimmed and inert", () => {
      const onPress = jest.fn();
      render(
        inLocale(
          "en",
          <GoButton
            label="GO"
            accessibilityLabel="Go online"
            onPress={onPress}
            disabled
            testID="go"
          />,
        ),
      );
      fireEvent.press(screen.getByTestId("go"));
      expect(onPress).not.toHaveBeenCalled();
      expect(screen.getByTestId("go")).toBeDisabled();
      expect(styleOf("go").opacity).toBe(0.4);
    });

    it("busy: spinner instead of the label, inert", () => {
      const onPress = jest.fn();
      render(
        inLocale(
          "en",
          <GoButton
            label="GO"
            accessibilityLabel="Go online"
            onPress={onPress}
            busy
            testID="go"
          />,
        ),
      );
      expect(screen.queryByText("GO")).toBeNull();
      expect(screen.getByTestId("go")).toHaveProp("accessibilityState", {
        checked: false,
        disabled: true,
        busy: true,
      });
      fireEvent.press(screen.getByTestId("go"));
      expect(onPress).not.toHaveBeenCalled();
    });
  });

  describe("MapFab", () => {
    it("shows an accent count badge, capped at 99+, and none at zero", () => {
      const { rerender } = render(
        inLocale(
          "en",
          <MapFab
            icon="menu"
            accessibilityLabel="Menu"
            onPress={() => {}}
            badge={120}
            badgeTestID="badge"
          />,
        ),
      );
      expect(screen.getByTestId("badge")).toHaveTextContent("99+");
      expect(styleOf("badge").backgroundColor).toBe(colors.accent);
      rerender(
        inLocale(
          "en",
          <MapFab
            icon="menu"
            accessibilityLabel="Menu"
            onPress={() => {}}
            badge={0}
            badgeTestID="badge"
          />,
        ),
      );
      expect(screen.queryByTestId("badge")).toBeNull();
      expect(screen.getByLabelText("Menu")).toBeTruthy();
    });
  });

  describe("BottomSheet", () => {
    it("pads its bottom to 34 or the inset, whichever is larger", () => {
      const metrics = (bottom: number) => ({
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, bottom, left: 0, right: 0 },
      });
      const sheet = (bottom: number) => (
        <SafeAreaProvider initialMetrics={metrics(bottom)}>
          {inLocale(
            "en",
            <BottomSheet testID="sheet">
              <AppText>x</AppText>
            </BottomSheet>,
          )}
        </SafeAreaProvider>
      );
      const { rerender } = render(sheet(48));
      const padding = () =>
        StyleSheet.flatten(
          screen.getByTestId("sheet").props.contentContainerStyle,
        ).paddingBottom;
      expect(padding()).toBe(48);
      rerender(sheet(0));
      expect(padding()).toBe(34);
    });
  });
});
