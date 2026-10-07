import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getMeta } from "../api/meta";
import type { ApiMeta } from "../api/meta";
import { colors } from "../theme/tokens";
import { AppText } from "./ui";

type ApiStatusState =
  { kind: "loading" } | { kind: "ok"; meta: ApiMeta } | { kind: "offline" };

/**
 * Shows the backend's live version fetched on mount, or a friendly offline
 * note when the API is unreachable. Never throws — a dead backend must not
 * crash the shell.
 */
export function ApiStatus() {
  const { t } = useTranslation();
  const [state, setState] = useState<ApiStatusState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    getMeta()
      .then((meta) => {
        if (!cancelled) setState({ kind: "ok", meta });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "offline" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const text =
    state.kind === "loading"
      ? t("settings.apiChecking")
      : state.kind === "offline"
        ? t("settings.apiOffline")
        : t("settings.apiVersion", { version: state.meta.version });

  return (
    <AppText
      variant="caption"
      weight="400"
      color={colors.textMuted}
      testID={`api-status-${state.kind}`}
    >
      {text}
    </AppText>
  );
}
