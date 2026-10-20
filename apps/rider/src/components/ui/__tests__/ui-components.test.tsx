/**
 * Design-system primitives: font family per locale/weight, RTL flips,
 * button disabled/loading states, chip/banner tones, the TextField focus and
 * password toggle, the ScreenHeader back chevron and the map-screen pieces.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { StyleSheet, Text, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  LANGUAGE_STORAGE_KEY,
  LocaleProvider,
} from "../../../i18n/locale-context";
import { colors } from "../../../theme/tokens";
import {
  AppText,
  Banner,
  BottomSheet,
  DestructiveButton,
  DestructiveTextButton,
  ListRow,
  MapFab,
  PrimaryButton,
  ScreenHeader,
  SecondaryButton,
  SHEET_BOTTOM_PADDING,
  StatusChip,
  TextField,
} from "..";

// Icons render as their name so tests can see which glyph (and direction) is drawn.
jest.mock("@expo/vector-icons", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: MockText } = require("react-native");
  return {
    Ionicons: ({ name }: { name: string }) => (
      <MockText testID={`icon-${name}`}>{name}</MockText>
    ),
  };
});

function flat<T extends ViewStyle | TextStyle>(style: unknown): T {
  return (StyleSheet.flatten(style as T) ?? {}) as T;
}

async function renderIn(locale: "en" | "ar", ui: React.ReactElement) {
  await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

describe("ui primitives", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  describe("AppText", () => {
    it("maps the weight to the Manrope per-weight family in EN", async () => {
      await renderIn(
        "en",
        <>
          <AppText variant="display" testID="display">
            Title
          </AppText>
          <AppText variant="secondary" testID="secondary">
            Body
          </AppText>
        </>,
      );
      const display = flat<TextStyle>(
        (await screen.findByTestId("display")).props.style,
      );
      expect(display.fontFamily).toBe("Manrope_800ExtraBold");
      expect(display.fontSize).toBe(32);
      expect(display.textAlign).toBeUndefined();
      expect(
        flat<TextStyle>(screen.getByTestId("secondary").props.style).fontFamily,
      ).toBe("Manrope_400Regular");
    });

    it("switches to IBM Plex Sans Arabic (800 → 700) and right-aligns in AR", async () => {
      await renderIn(
        "ar",
        <AppText variant="display" testID="display">
          عنوان
        </AppText>,
      );
      const style = flat<TextStyle>(
        (await screen.findByTestId("display")).props.style,
      );
      expect(style.fontFamily).toBe("IBMPlexSansArabic_700Bold");
      expect(style.textAlign).toBe("right");
      expect(style.writingDirection).toBe("rtl");
    });

    it("falls back to Manrope outside a LocaleProvider", async () => {
      await render(<AppText testID="plain">x</AppText>);
      expect(
        flat<TextStyle>(screen.getByTestId("plain").props.style).fontFamily,
      ).toBe("Manrope_400Regular");
    });
  });

  describe("buttons", () => {
    it("fires the primary action when enabled", async () => {
      const onPress = jest.fn();
      await renderIn(
        "en",
        <PrimaryButton label="Go" onPress={onPress} testID="go" />,
      );
      await fireEvent.press(await screen.findByText("Go"));
      expect(onPress).toHaveBeenCalledTimes(1);
      const style = flat<ViewStyle>(screen.getByTestId("go").props.style);
      expect(style.height).toBe(56);
      expect(style.borderRadius).toBe(14);
      expect(style.backgroundColor).toBe(colors.accent);
    });

    it("is disabled at 40 % opacity and ignores presses", async () => {
      const onPress = jest.fn();
      await renderIn(
        "en",
        <PrimaryButton label="Go" onPress={onPress} disabled testID="go" />,
      );
      const button = await screen.findByTestId("go");
      expect(button).toBeDisabled();
      expect(flat<ViewStyle>(button.props.style).opacity).toBe(0.4);
      await fireEvent.press(button);
      expect(onPress).not.toHaveBeenCalled();
    });

    it("shows a spinner instead of the label while loading", async () => {
      const onPress = jest.fn();
      await renderIn(
        "en",
        <SecondaryButton
          label="Send"
          onPress={onPress}
          loading
          testID="send"
        />,
      );
      expect(await screen.findByTestId("send-loading")).toBeOnTheScreen();
      expect(screen.queryByText("Send")).toBeNull();
      expect(screen.getByTestId("send")).toBeDisabled();
    });

    it("renders the destructive action as danger text without a fill", async () => {
      await renderIn(
        "en",
        <DestructiveTextButton
          label="Delete"
          onPress={jest.fn()}
          testID="del"
        />,
      );
      const label = await screen.findByText("Delete");
      expect(flat<TextStyle>(label.props.style).color).toBe(colors.danger);
      expect(
        flat<ViewStyle>(screen.getByTestId("del").props.style).backgroundColor,
      ).toBeUndefined();
    });

    it("renders the costly destructive confirm outlined in danger (RiderCancel)", async () => {
      await renderIn(
        "en",
        <DestructiveButton
          label="Cancel ride · SYP 2,000 fee"
          onPress={jest.fn()}
          testID="confirm"
        />,
      );
      const label = await screen.findByText("Cancel ride · SYP 2,000 fee");
      expect(flat<TextStyle>(label.props.style).color).toBe(colors.danger);
      expect(flat<ViewStyle>(screen.getByTestId("confirm").props.style)).toMatchObject({
        height: 56,
        backgroundColor: colors.surface,
        borderWidth: 1.5,
        borderColor: colors.danger,
      });
    });
  });

  describe("StatusChip and Banner tones", () => {
    it.each([
      ["accent", colors.accentTint, colors.accent],
      ["success", colors.successBg, colors.success],
      ["warning", colors.warningBg, colors.warning],
      ["danger", colors.dangerBg, colors.danger],
      ["neutral", colors.surfaceFill, colors.textSecondary],
    ] as const)("paints the %s chip", async (tone, ground, text) => {
      await renderIn(
        "en",
        <StatusChip tone={tone} label="Valid" testID="chip" />,
      );
      expect(
        flat<ViewStyle>((await screen.findByTestId("chip")).props.style)
          .backgroundColor,
      ).toBe(ground);
      expect(flat<TextStyle>(screen.getByText("Valid").props.style).color).toBe(
        text,
      );
    });

    it("shows the banner title, message and tone icon", async () => {
      await renderIn(
        "en",
        <Banner
          tone="warning"
          title="Heads up"
          message="Renew soon."
          testID="banner"
        />,
      );
      expect(await screen.findByTestId("banner")).toHaveTextContent(
        "Heads upRenew soon.",
      );
      expect(screen.getByTestId("icon-alert-circle-outline")).toBeOnTheScreen();
    });
  });

  describe("ListRow", () => {
    it("lays out start → end with a forward chevron in EN", async () => {
      const onPress = jest.fn();
      await renderIn(
        "en",
        <ListRow
          title="Profile"
          subtitle="Name"
          icon="person-outline"
          chevron
          onPress={onPress}
          testID="row"
        />,
      );
      const row = await screen.findByTestId("row");
      expect(flat<ViewStyle>(row.props.style).flexDirection).toBe("row");
      expect(screen.getByTestId("icon-chevron-forward")).toBeOnTheScreen();
      await fireEvent.press(row);
      expect(onPress).toHaveBeenCalled();
    });

    it("flips the row and the chevron in RTL", async () => {
      await renderIn(
        "ar",
        <ListRow title="الملف" chevron onPress={jest.fn()} testID="row" />,
      );
      const row = await screen.findByTestId("row");
      // The test runtime never restarts into native RTL, so the row is flipped by hand.
      expect(flat<ViewStyle>(row.props.style).flexDirection).toBe(
        "row-reverse",
      );
      expect(screen.getByTestId("icon-chevron-back")).toBeOnTheScreen();
    });
  });

  describe("TextField", () => {
    it("outlines on focus and keeps the password eye toggle", async () => {
      await renderIn(
        "en",
        <TextField label="Password" secureTextEntry testID="pw" />,
      );
      const input = await screen.findByTestId("pw");
      expect(input.props.secureTextEntry).toBe(true);
      expect(flat<ViewStyle>(input.props.style).borderColor).toBe(
        "transparent",
      );

      await fireEvent(input, "focus");
      expect(
        flat<ViewStyle>(screen.getByTestId("pw").props.style).borderColor,
      ).toBe(colors.text);

      await fireEvent.press(screen.getByTestId("pw-reveal"));
      expect(screen.getByTestId("pw").props.secureTextEntry).toBe(false);
      expect(screen.getByLabelText("Hide password")).toBeOnTheScreen();
    });

    it("shows the error with a danger outline", async () => {
      await renderIn(
        "en",
        <TextField label="Phone" error="Invalid" testID="phone" />,
      );
      expect(await screen.findByTestId("phone-error")).toHaveTextContent(
        "Invalid",
      );
      expect(
        flat<ViewStyle>(screen.getByTestId("phone").props.style).borderColor,
      ).toBe(colors.danger);
    });
  });

  describe("ScreenHeader", () => {
    it("renders the title and a back chevron that goes back", async () => {
      const onBack = jest.fn();
      await renderIn("en", <ScreenHeader title="Settings" onBack={onBack} />);
      expect(await screen.findByText("Settings")).toBeOnTheScreen();
      expect(screen.getByTestId("icon-chevron-back")).toBeOnTheScreen();
      await fireEvent.press(screen.getByLabelText("Back"));
      expect(onBack).toHaveBeenCalled();
      // A full 48 px touch target (V1 audit I92).
      expect(
        flat<ViewStyle>(screen.getByTestId("screen-header-back").props.style),
      ).toMatchObject({ width: 48, height: 48 });
    });

    it("points the back chevron the other way in RTL", async () => {
      await renderIn(
        "ar",
        <ScreenHeader title="الإعدادات" onBack={jest.fn()} />,
      );
      expect(await screen.findByLabelText("رجوع")).toBeOnTheScreen();
      expect(screen.getByTestId("icon-chevron-forward")).toBeOnTheScreen();
    });

    it("hides the back button when there is nowhere to go back to", async () => {
      await renderIn("en", <ScreenHeader title="Log in" />);
      expect(await screen.findByText("Log in")).toBeOnTheScreen();
      expect(screen.queryByTestId("screen-header-back")).toBeNull();
    });
  });

  describe("map screen pieces", () => {
    it("labels the floating button and shows its badge", async () => {
      const onPress = jest.fn();
      await renderIn(
        "en",
        <MapFab
          icon="menu"
          accessibilityLabel="Settings"
          onPress={onPress}
          badge={<Text testID="badge">3</Text>}
        />,
      );
      await fireEvent.press(await screen.findByLabelText("Settings"));
      expect(onPress).toHaveBeenCalled();
      expect(screen.getByTestId("badge")).toBeOnTheScreen();
    });

    it("pads the sheet bottom by 34 or the safe-area inset, whichever is larger", async () => {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
      await render(
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 0, bottom: 20, left: 0, right: 0 },
          }}
        >
          <LocaleProvider>
            <BottomSheet testID="sheet">
              <Text>content</Text>
            </BottomSheet>
          </LocaleProvider>
        </SafeAreaProvider>,
      );
      const style = flat<ViewStyle>(
        (await screen.findByTestId("sheet")).props.style,
      );
      expect(style.paddingBottom).toBe(SHEET_BOTTOM_PADDING);
      expect(style.borderTopStartRadius).toBe(24);
    });
  });
});
