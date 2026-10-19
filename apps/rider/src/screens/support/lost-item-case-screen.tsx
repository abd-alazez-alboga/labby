/**
 * Lost-item case, rider view (UC-R-20, LOST-02) — approved artboard
 * R14LostCase: the case's progress timeline, the reopened-chat entry (the
 * thread stays writable while the case is open and returns to read-only
 * when it closes) and the support-thread entry for questions.
 */
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";

import { failureKind, type FailureKind } from "../../api/http-client";
import {
  getLostItemCase,
  type CaseStatus,
  type LostItemCase,
  type LostItemOutcome,
} from "../../api/support";
import {
  AppText,
  ErrorView,
  ListRow,
  LoadingView,
  ScreenScrollView,
  screenStyles,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { formatDate } from "../../ride/ride-format";
import { colors, spacing } from "../../theme/tokens";

type StepKey = CaseStatus;

/** The outcome a case reached: the contract's `outcome`, else its live status. */
function outcomeOf(item: LostItemCase): LostItemOutcome | null {
  if (item.outcome) return item.outcome;
  switch (item.caseStatus) {
    case "found":
    case "not_found":
    case "returned":
      return item.caseStatus;
    default:
      return null;
  }
}

/**
 * The timeline rows and which are done. The outcome row reads "Not found"
 * when the item was not found (also after closure), and then no "Returned"
 * row follows; a closed case ends with a done "Closed" row.
 */
function timelineOf(item: LostItemCase): { key: StepKey; done: boolean }[] {
  const outcome = outcomeOf(item);
  const closed = item.caseStatus === "closed";
  const contacted =
    item.caseStatus !== "reported" && (!closed || outcome !== null);
  const steps: { key: StepKey; done: boolean }[] = [
    { key: "reported", done: true },
    { key: "driver_contacted", done: contacted },
    {
      key: outcome === "not_found" ? "not_found" : "found",
      done: outcome !== null,
    },
  ];
  if (outcome !== "not_found") {
    steps.push({ key: "returned", done: outcome === "returned" });
  }
  if (closed) steps.push({ key: "closed", done: true });
  return steps;
}

export default function LostItemCaseScreen({ ticketId }: { ticketId: string }) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const router = useRouter();
  const [item, setItem] = useState<LostItemCase | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [failure, setFailure] = useState<FailureKind>("network");

  const load = useCallback(async () => {
    try {
      setItem(await getLostItemCase(ticketId));
      setStatus("ready");
    } catch (error) {
      setFailure(failureKind(error));
      setStatus("error");
    }
  }, [ticketId]);

  // Reload on focus: support may have progressed the case meanwhile.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (status === "error") {
    return (
      <ErrorView
        kind={failure}
        onRetry={() => {
          setStatus("loading");
          void load();
        }}
      />
    );
  }
  if (status === "loading" || !item) {
    return <LoadingView testID="lost-case-loading" />;
  }

  const steps = timelineOf(item);
  const chatOpen = item.chatWindow !== "read_only";
  const driverName = item.driver.name;

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      testID="lost-case"
    >
      <View style={styles.header}>
        <AppText variant="title">
          {t("lostItem.caseTitle")} · {item.description}
        </AppText>
        <AppText variant="caption" tone="muted" weight={400}>
          {t("lostItem.rideLine", {
            date: formatDate(
              item.ride.startedAt ?? item.createdAt,
              locale,
            ),
            name: driverName,
          })}
        </AppText>
      </View>

      <View style={styles.timeline} testID="lost-case-timeline">
        {steps.map(({ key: step, done }, index) => {
          const last = index === steps.length - 1;
          const nextDone = !last && steps[index + 1].done;
          return (
            <View key={step} style={[styles.step, { flexDirection: row }]}>
              <View style={styles.stepRail}>
                <View
                  style={[styles.dot, done ? styles.dotDone : styles.dotIdle]}
                  testID={`lost-case-step-${step}-${done ? "done" : "todo"}`}
                >
                  {done ? (
                    <Ionicons
                      name="checkmark"
                      size={13}
                      color={colors.onAccent}
                    />
                  ) : null}
                </View>
                {!last ? (
                  <View
                    style={[
                      styles.rail,
                      nextDone ? styles.railDone : styles.railIdle,
                    ]}
                  />
                ) : null}
              </View>
              <AppText
                variant="bodyStrong"
                weight={done ? 800 : 700}
                tone={done ? "default" : "muted"}
                style={styles.stepLabel}
              >
                {t(`lostItem.steps.${step}`)}
              </AppText>
            </View>
          );
        })}
      </View>

      <View>
        <ListRow
          testID="lost-case-chat"
          title={t("lostItem.chatWith", { name: driverName })}
          subtitle={
            chatOpen
              ? t("lostItem.chatOpenHint")
              : t("lostItem.chatClosedHint")
          }
          icon="chatbubble-ellipses-outline"
          chevron
          onPress={() =>
            router.push(
              `/chat/${encodeURIComponent(item.ride.rideId)}` as never,
            )
          }
        />
        <ListRow
          testID="lost-case-support"
          title={t("lostItem.messageSupport")}
          subtitle={t("lostItem.messageSupportHint")}
          icon="help-circle-outline"
          chevron
          last
          onPress={() =>
            router.push(
              `/ticket/${encodeURIComponent(item.ticketId)}` as never,
            )
          }
        />
      </View>

      <AppText variant="caption" tone="muted" weight={400} style={styles.note}>
        {t("lostItem.footnote")}
      </AppText>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xs,
  },
  timeline: {
    paddingVertical: spacing.sm,
  },
  step: {
    gap: spacing.md,
    alignItems: "flex-start",
  },
  stepRail: {
    alignItems: "center",
  },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  dotDone: {
    backgroundColor: colors.accent,
  },
  dotIdle: {
    borderWidth: 2.5,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  rail: {
    width: 2.5,
    height: 28,
  },
  railDone: {
    backgroundColor: colors.accent,
  },
  railIdle: {
    backgroundColor: colors.lineStrong,
  },
  stepLabel: {
    paddingTop: 2,
  },
  note: {
    lineHeight: 20,
  },
});
