import { Redirect, Stack } from "expo-router";
import React from "react";

import { useAuth } from "../../auth/auth-context";
import { ChatProvider } from "../../chat/chat-context";
import { useLocale } from "../../i18n/locale-context";
import { ScreenHeader } from "../../components/ui";
import { NotificationsProvider } from "../../notifications/notifications-context";
import { RegionProvider } from "../../region/region-context";
import { RideProvider } from "../../ride/ride-context";
import { colors } from "../../theme/tokens";

/**
 * Signed-in stack: home, settings, the account-management screens and the
 * notification center + preferences, and the M7 ride screens. Every screen
 * but the map-first ones (home, booking, route change, the ride opened from
 * a push, the receipt) gets the design-system ScreenHeader (back chevron +
 * large title). Region resolution, notification state (badge, push
 * registration, push taps) and the ride facade (realtime socket + the
 * current ride) live only while signed in. M11 adds the rating screen,
 * the report flow and the rider's reports list. M12 adds scheduling (the
 * flow, the upcoming list and one scheduled ride) and shared rides
 * (browse, create, one shared ride).
 */
export default function AppLayout() {
  const { status } = useAuth();
  const { t } = useLocale();

  if (status !== "signedIn") {
    return <Redirect href="/welcome" />;
  }

  return (
    <RegionProvider>
      <RideProvider>
      <ChatProvider>
      <NotificationsProvider>
        <Stack
          screenOptions={{
            header: ({ navigation, options, back }) => (
              <ScreenHeader
                title={typeof options.title === "string" ? options.title : ""}
                onBack={back ? navigation.goBack : undefined}
              />
            ),
            contentStyle: { backgroundColor: colors.surface },
          }}
        >
          {/* Home is map-first: no header, floating buttons over the map. */}
          <Stack.Screen
            name="index"
            options={{ title: t("common.appName"), headerShown: false }}
          />
          <Stack.Screen
            name="settings"
            options={{ title: t("settings.title") }}
          />
          <Stack.Screen
            name="profile-edit"
            options={{ title: t("profile.title") }}
          />
          <Stack.Screen
            name="change-password"
            options={{ title: t("changePassword.title") }}
          />
          <Stack.Screen
            name="change-phone"
            options={{ title: t("changePhone.title") }}
          />
          <Stack.Screen
            name="delete-account"
            options={{ title: t("deleteAccount.title") }}
          />
          <Stack.Screen
            name="notifications"
            options={{ title: t("notifications.title") }}
          />
          <Stack.Screen
            name="notification-preferences"
            options={{ title: t("preferences.title") }}
          />
          <Stack.Screen
            name="dev-route-preview"
            options={{ title: t("routePreview.title") }}
          />
          {/* M7 ride flow: map-first screens draw their own floating back. */}
          <Stack.Screen name="booking" options={{ headerShown: false }} />
          <Stack.Screen name="change-route" options={{ headerShown: false }} />
          <Stack.Screen name="ride/[rideId]" options={{ headerShown: false }} />
          {/* M10: the in-ride chat draws its own thread header. */}
          <Stack.Screen name="chat/[rideId]" options={{ headerShown: false }} />
          <Stack.Screen
            name="receipt/[rideId]"
            options={{ headerShown: false }}
          />
          <Stack.Screen name="rides" options={{ title: t("history.title") }} />
          {/* M8: wallet, routed from Settings like the ride screens. */}
          <Stack.Screen name="wallet" options={{ title: t("wallet.title") }} />
          <Stack.Screen
            name="saved-places"
            options={{ title: t("savedPlaces.title") }}
          />
          <Stack.Screen
            name="ride-preferences"
            options={{ title: t("ridePrefs.title") }}
          />
          {/* M11 trust: rating + report draw their own top bar / header. */}
          <Stack.Screen name="rate/[rideId]" options={{ headerShown: false }} />
          <Stack.Screen
            name="report/[rideId]"
            options={{ headerShown: false }}
          />
          <Stack.Screen name="reports" options={{ title: t("reports.title") }} />
          {/* M12: scheduling (map-first flow) + upcoming list / detail. */}
          <Stack.Screen name="schedule" options={{ headerShown: false }} />
          <Stack.Screen
            name="scheduled/index"
            options={{ title: t("scheduled.listTitle") }}
          />
          <Stack.Screen
            name="scheduled/[rideId]"
            options={{ headerShown: false }}
          />
          {/* M12: shared rides — browse, create, one ride (join / members). */}
          <Stack.Screen
            name="shared/index"
            options={{ title: t("shared.browseTitle") }}
          />
          <Stack.Screen name="shared/create" options={{ headerShown: false }} />
          <Stack.Screen name="shared/[rideId]" options={{ headerShown: false }} />
          {/* M13 growth: referral, loyalty, badges/level, challenges. */}
          <Stack.Screen
            name="referral"
            options={{ title: t("growth.referral.title") }}
          />
          <Stack.Screen
            name="loyalty"
            options={{ title: t("growth.loyalty.title") }}
          />
          <Stack.Screen
            name="badges"
            options={{ title: t("growth.badges.title") }}
          />
          <Stack.Screen
            name="challenges"
            options={{ title: t("growth.challenges.title") }}
          />
        </Stack>
      </NotificationsProvider>
      </ChatProvider>
      </RideProvider>
    </RegionProvider>
  );
}
