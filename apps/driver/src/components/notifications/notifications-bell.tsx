import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import {
  refreshUnread,
  useUnreadCount,
} from "../../notifications/unread-store";
import { MapFab } from "../ui";

/**
 * Bell + unread count badge (UC-S-11); refreshes the count whenever its
 * screen gains focus. Floats over the map on home; `plain` on white screens.
 */
export function NotificationsBell({
  variant = "floating",
}: {
  variant?: "floating" | "plain";
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const unread = useUnreadCount();

  useFocusEffect(
    useCallback(() => {
      void refreshUnread();
    }, []),
  );

  return (
    <MapFab
      icon="notifications-outline"
      accessibilityLabel={
        unread > 0
          ? t("notifications.bellUnread", { count: unread })
          : t("notifications.bell")
      }
      onPress={() => router.push("/notifications")}
      badge={unread}
      badgeTestID="notifications-badge"
      variant={variant}
      testID="notifications-bell"
    />
  );
}
