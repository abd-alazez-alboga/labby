import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { ApiError } from "../../api/client";
import type { Ride } from "../../api/ride-types";
import { rideErrorOf } from "../../api/rides";
import {
  claimScheduledRide,
  getAvailabilityWindows,
  getClaimBoard,
  getClaimedRides,
  releaseScheduledRide,
} from "../../api/scheduled";
import type {
  ClaimBoardBlockedReason,
  ClaimBoardEntry,
  ClaimReleaseReason,
} from "../../api/scheduled-types";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { useOptionalDriverRide } from "../../rides/DriverRideProvider";
import { formatMoney, formatNumber } from "../../rides/format";
import { useNow } from "../../rides/use-now";
import { formatRelative, formatWhen, isSoon } from "../../scheduled/format";
import { colors, radius, spacing } from "../../theme/tokens";
import {
  AppText,
  Banner,
  FailureState,
  Icon,
  LoadingState,
  PrimaryButton,
  Screen,
  ScreenHeader,
  SecondaryButton,
  StatusChip,
  TextButton,
  useDirection,
} from "../ui";
import { FloorBoardBlocked } from "../money/floor";
import { RouteSteps } from "../ride/ride-parts";
import { ReleaseSheet } from "./release-sheet";

export type ScheduledTab = "board" | "mine";

const PAGE_SIZE = 20;

type BoardLoad =
  | { status: "loading" }
  | {
      status: "loaded";
      items: ClaimBoardEntry[];
      page: number;
      totalItems: number;
      hasWindows: boolean;
      /** H7: at/below the balance floor the board is closed (items empty). */
      blockedReason: ClaimBoardBlockedReason | null;
    }
  | { status: "error"; kind: FailureKind };

type MineLoad =
  | { status: "loading" }
  | { status: "loaded"; rides: Ride[] }
  | { status: "error"; kind: FailureKind };

/** Outcome banners of the screen's own actions. */
type Notice =
  | { kind: "claimed"; when: string }
  | { kind: "alreadyClaimed" }
  | { kind: "claimClosed" }
  | { kind: "notEligible"; rule: string }
  | { kind: "released" }
  | { kind: "alreadyLive" }
  | { kind: "failed"; error: "network" | "server" };

const NOT_ELIGIBLE_RULES = ["window", "service_type", "driver"];

function Tabs({
  tab,
  mineCount,
  onChange,
}: {
  tab: ScheduledTab;
  mineCount: number | null;
  onChange: (tab: ScheduledTab) => void;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const tabs: { key: ScheduledTab; label: string }[] = [
    { key: "board", label: t("scheduled.tabs.board") },
    {
      key: "mine",
      label:
        mineCount !== null && mineCount > 0
          ? t("scheduled.tabs.mineCount", {
              count: formatNumber(mineCount, language),
            })
          : t("scheduled.tabs.mine"),
    },
  ];
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.tabs, flipRows && styles.rowReverse]}
    >
      {tabs.map((item) => {
        const selected = item.key === tab;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(item.key)}
            style={[styles.tab, selected && styles.tabSelected]}
            testID={`scheduled-tab-${item.key}`}
          >
            <AppText
              variant="bodyStrong"
              weight={selected ? "800" : "700"}
              color={selected ? colors.text : colors.textSecondary}
              align="center"
            >
              {item.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function CardHeader({
  when,
  relative,
  chip,
  testID,
}: {
  when: string;
  relative: string;
  chip: React.ReactNode;
  testID: string;
}) {
  const { flipRows } = useDirection();
  return (
    <View style={[styles.cardHeader, flipRows && styles.rowReverse]}>
      <View style={styles.grow}>
        <AppText variant="heading" testID={`${testID}-when`}>
          {when}
        </AppText>
        <AppText variant="secondary" color={colors.textSecondary}>
          {relative}
        </AppText>
      </View>
      {chip}
    </View>
  );
}

/** Artboard "Claim board" card: time, pickup area ≈, destination, estimate, Claim. */
function BoardCard({
  entry,
  now,
  claiming,
  disabled,
  onClaim,
}: {
  entry: ClaimBoardEntry;
  now: number;
  claiming: boolean;
  disabled: boolean;
  onClaim: () => void;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const service =
    language === "ar" ? entry.serviceTypeNameAr : entry.serviceTypeNameEn;
  const stops = entry.stopsCount ?? 0;
  const id = `board-${entry.rideId}`;
  return (
    <View style={styles.card} testID={id}>
      <CardHeader
        when={formatWhen(entry.scheduledAt, language)}
        relative={formatRelative(t, entry.scheduledAt, language, now)}
        chip={
          <StatusChip
            tone="neutral"
            label={
              stops > 0
                ? t("scheduled.board.serviceWithStops", {
                    service,
                    count: formatNumber(stops, language),
                  })
                : service
            }
          />
        }
        testID={id}
      />
      <RouteSteps
        steps={[
          {
            key: "pickup",
            caption: t("scheduled.board.pickupArea"),
            place: entry.pickupArea,
            testID: `${id}-pickup`,
          },
          {
            key: "destination",
            caption: t("scheduled.board.destination"),
            place: entry.destination,
            final: true,
            testID: `${id}-destination`,
          },
        ]}
      />
      <View style={[styles.cardFooter, flipRows && styles.rowReverse]}>
        <View style={styles.grow}>
          <AppText variant="heading" testID={`${id}-fare`}>
            {formatMoney(entry.estimatedFare, entry.currency, language)}
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {t("scheduled.pricedAtRideTimeWith", {
              payment: t(`ride.payment.${entry.paymentMethod}`),
            })}
          </AppText>
        </View>
        <View style={styles.claimButton}>
          <PrimaryButton
            title={t("scheduled.board.claim")}
            onPress={onClaim}
            disabled={disabled}
            busy={claiming}
            testID={`${id}-claim`}
          />
        </View>
      </View>
    </View>
  );
}

/** Artboard "My claimed rides" card: exact pickup, rider, reminders, Release. */
function ClaimedCard({
  ride,
  now,
  onRelease,
}: {
  ride: Ride;
  now: number;
  onRelease: () => void;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const scheduledAt = ride.scheduled?.scheduledAt ?? ride.timeline.requestedAt;
  const name = ride.rider?.firstName?.trim() || t("ride.theRider");
  const soon = isSoon(scheduledAt, now);
  const id = `claimed-${ride.id}`;
  return (
    <View style={styles.card} testID={id}>
      <CardHeader
        when={formatWhen(scheduledAt, language)}
        relative={t("scheduled.mine.relativeWithRider", {
          relative: formatRelative(t, scheduledAt, language, now),
          name,
        })}
        chip={
          soon ? (
            <StatusChip
              tone="accent"
              label={t("scheduled.mine.goesLiveSoon")}
              testID={`${id}-soon`}
            />
          ) : (
            <StatusChip tone="success" label={t("scheduled.mine.claimed")} />
          )
        }
        testID={id}
      />
      <RouteSteps
        steps={[
          {
            key: "pickup",
            caption: t("scheduled.mine.pickup"),
            place: ride.pickup,
            testID: `${id}-pickup`,
          },
          ...ride.stops.map((stop, index) => ({
            key: `stop-${index}`,
            caption: t("ride.stopN", { n: formatNumber(index + 1, language) }),
            place: stop,
          })),
          {
            key: "destination",
            caption: t("scheduled.board.destination"),
            place: ride.destination,
            final: true,
          },
        ]}
      />
      <View style={[styles.reminder, flipRows && styles.rowReverse]}>
        <Icon name="notifications-outline" size={16} color={colors.textSecondary} />
        <AppText variant="caption" weight="400" color={colors.textSecondary}>
          {t("scheduled.mine.reminders")}
        </AppText>
      </View>
      <View style={[styles.cardFooter, flipRows && styles.rowReverse]}>
        <View style={styles.grow}>
          <AppText variant="bodyStrong" weight="800">
            {formatMoney(
              ride.estimate.components.total,
              ride.estimate.components.currency,
              language,
            )}
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {t("scheduled.pricedAtRideTimeWith", {
              payment: t(`ride.payment.${ride.paymentMethod}`),
            })}
          </AppText>
        </View>
        <View style={styles.claimButton}>
          <SecondaryButton
            title={t("scheduled.mine.release")}
            onPress={onRelease}
            testID={`${id}-release`}
          />
        </View>
      </View>
    </View>
  );
}

function NoticeBanner({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const common = { testID: `scheduled-notice-${notice.kind}` };
  let body: React.ReactNode;
  switch (notice.kind) {
    case "claimed":
      body = (
        <Banner
          tone="success"
          title={t("scheduled.notices.claimedTitle", { when: notice.when })}
          message={t("scheduled.notices.claimedBody")}
          {...common}
        />
      );
      break;
    case "alreadyClaimed":
    case "claimClosed":
    case "alreadyLive":
      body = (
        <Banner
          tone="warning"
          title={t(`scheduled.notices.${notice.kind}Title`)}
          message={t(`scheduled.notices.${notice.kind}Body`)}
          {...common}
        />
      );
      break;
    case "notEligible":
      body = (
        <Banner
          tone="warning"
          title={t("scheduled.notices.notEligibleTitle")}
          message={t(
            `scheduled.notices.notEligible.${
              NOT_ELIGIBLE_RULES.includes(notice.rule) ? notice.rule : "other"
            }`,
          )}
          {...common}
        />
      );
      break;
    case "released":
      body = (
        <Banner
          tone="neutral"
          message={t("scheduled.notices.released")}
          {...common}
        />
      );
      break;
    case "failed":
      body = (
        <Banner
          tone="danger"
          message={t(`ride.errors.${notice.error}`)}
          {...common}
        />
      );
      break;
  }
  return (
    <View style={styles.noticeWrap}>
      {body}
      <TextButton
        title={t("ride.dismiss")}
        onPress={onDismiss}
        testID="scheduled-notice-dismiss"
      />
    </View>
  );
}

/**
 * UC-D-11 / UC-D-12, artboards "Claim board", "Already claimed", "Board · no
 * availability", "My claimed rides", "Release a claim": two tabs over the
 * scheduled-ride work of a driver.
 * - Board (`GET /driver/claim-board`): open rides inside the driver's
 *   windows; Claim locks one (`POST …/claim`). A lost race (409
 *   `already_claimed` / `claim_closed`) or a 422 `not_eligible` says so and
 *   refreshes the board (E1). No windows → "Set your availability first".
 *   At/below the COM-03 balance floor (H7) the board answers
 *   `blockedReason: balance_below_floor` — "Settle your balance to see
 *   scheduled rides" with "See my balance"; a claim refused 422
 *   `not_eligible` / `balance_below_floor` lands on the same state.
 * - My rides (`GET /driver/scheduled-rides`): claims not yet live with the
 *   exact pickup, the rider and a Release (`POST …/release`, reason sheet).
 * Every claim goes live by itself shortly before pickup (the T−15 conversion
 * lands on the home route as the live ride).
 */
export function ScheduledRidesScreen({
  initialTab = "board",
}: {
  initialTab?: ScheduledTab;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const router = useRouter();
  const rides = useOptionalDriverRide();
  const now = useNow(true, 30_000);
  const [tab, setTab] = useState<ScheduledTab>(initialTab);
  const [board, setBoard] = useState<BoardLoad>({ status: "loading" });
  const [mine, setMine] = useState<MineLoad>({ status: "loading" });
  const [claiming, setClaiming] = useState<string | null>(null);
  const [releasing, setReleasing] = useState<Ride | null>(null);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseError, setReleaseError] = useState<"network" | "server" | null>(
    null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchBoard = useCallback(async (page = 0) => {
    if (page === 0) setBoard({ status: "loading" });
    try {
      const [result, windows] = await Promise.all([
        getClaimBoard(page, PAGE_SIZE),
        page === 0 ? getAvailabilityWindows() : Promise.resolve(null),
      ]);
      if (!mounted.current) return;
      setBoard((previous) => ({
        status: "loaded",
        items:
          page > 0 && previous.status === "loaded"
            ? [...previous.items, ...result.items]
            : result.items,
        page: result.page,
        totalItems: result.totalItems,
        hasWindows: windows
          ? windows.windows.length > 0
          : previous.status === "loaded" && previous.hasWindows,
        blockedReason: result.blockedReason ?? null,
      }));
    } catch (caught) {
      if (mounted.current)
        setBoard({ status: "error", kind: failureKindOf(caught) });
    }
  }, []);

  const fetchMine = useCallback(async () => {
    try {
      const result = await getClaimedRides();
      if (mounted.current) setMine({ status: "loaded", rides: result });
    } catch (caught) {
      if (mounted.current)
        setMine({ status: "error", kind: failureKindOf(caught) });
    }
  }, []);

  // M12 review W13: re-read on every focus — e.g. back from the availability
  // windows screen the empty board's "Set your availability" button opened.
  useFocusEffect(
    useCallback(() => {
      void fetchBoard(0);
      void fetchMine();
    }, [fetchBoard, fetchMine]),
  );

  const refreshAll = () => {
    setMine({ status: "loading" });
    void fetchBoard(0);
    void fetchMine();
  };

  const claim = async (entry: ClaimBoardEntry) => {
    setClaiming(entry.rideId);
    setNotice(null);
    try {
      await claimScheduledRide(entry.rideId);
      if (!mounted.current) return;
      setNotice({
        kind: "claimed",
        when: formatWhen(entry.scheduledAt, language),
      });
      void fetchBoard(0);
      void fetchMine();
    } catch (caught) {
      if (!mounted.current) return;
      const coded = rideErrorOf(caught);
      if (coded?.status === 409 || coded?.status === 404) {
        setNotice({
          kind: coded.code === "already_claimed" ? "alreadyClaimed" : "claimClosed",
        });
        void fetchBoard(0);
      } else if (
        coded?.status === 422 &&
        coded.details.rule === "balance_below_floor"
      ) {
        // H7: the floor closed the board meanwhile — show its blocked state.
        setBoard((previous) =>
          previous.status === "loaded"
            ? {
                ...previous,
                items: [],
                totalItems: 0,
                blockedReason: "balance_below_floor",
              }
            : previous,
        );
        void fetchBoard(0);
      } else if (coded?.status === 422) {
        const rule = coded.details.rule;
        setNotice({ kind: "notEligible", rule: typeof rule === "string" ? rule : "" });
        void fetchBoard(0);
      } else {
        setNotice({
          kind: "failed",
          error: caught instanceof ApiError ? "server" : "network",
        });
      }
    } finally {
      if (mounted.current) setClaiming(null);
    }
  };

  const release = async (reason: ClaimReleaseReason, note?: string) => {
    const target = releasing;
    if (!target) return;
    setReleaseBusy(true);
    setReleaseError(null);
    try {
      await releaseScheduledRide(target.id, reason, note);
      if (!mounted.current) return;
      setReleasing(null);
      setNotice({ kind: "released" });
      void fetchMine();
      void fetchBoard(0);
    } catch (caught) {
      if (!mounted.current) return;
      const status = caught instanceof ApiError ? caught.status : 0;
      if (status === 409 || status === 403 || status === 404) {
        // Converted (or no longer ours) meanwhile: the home route has it now.
        setReleasing(null);
        setNotice({ kind: "alreadyLive" });
        void fetchMine();
        void rides?.resync();
      } else {
        setReleaseError(caught instanceof ApiError ? "server" : "network");
      }
    } finally {
      if (mounted.current) setReleaseBusy(false);
    }
  };

  const mineCount = mine.status === "loaded" ? mine.rides.length : null;

  return (
    <View style={styles.fill}>
      <Screen
        testID="scheduled-rides-screen"
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={refreshAll} />
        }
        header={
          <View style={styles.header}>
            <View style={[styles.headerRow, flipRows && styles.rowReverse]}>
              <ScreenHeader />
              <View style={styles.grow} />
              <SecondaryButton
                title={t("scheduled.availability.title")}
                icon="calendar-outline"
                onPress={() => router.push("/availability-windows")}
                testID="open-availability"
              />
            </View>
            <AppText variant="display" accessibilityRole="header">
              {t("scheduled.title")}
            </AppText>
            <Tabs tab={tab} mineCount={mineCount} onChange={setTab} />
          </View>
        }
      >
        {notice ? (
          <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
        ) : null}

        {tab === "board" ? (
          <>
            {board.status === "loading" ? (
              <LoadingState testID="board-loading" />
            ) : null}
            {board.status === "error" ? (
              <FailureState
                kind={board.kind}
                onRetry={() => void fetchBoard(0)}
                testID="board-error"
              />
            ) : null}
            {board.status === "loaded" && board.blockedReason ? (
              <FloorBoardBlocked onSeeBalance={() => router.push("/balance")} />
            ) : null}
            {board.status === "loaded" &&
            !board.blockedReason &&
            board.items.length === 0 ? (
              board.hasWindows ? (
                <AppText
                  color={colors.textSecondary}
                  align="center"
                  testID="board-empty"
                >
                  {t("scheduled.board.empty")}
                </AppText>
              ) : (
                <View style={styles.empty} testID="board-no-windows">
                  <View style={styles.emptyIcon}>
                    <Icon name="calendar-outline" size={32} color={colors.accent} />
                  </View>
                  <AppText variant="heading" align="center">
                    {t("scheduled.board.noWindowsTitle")}
                  </AppText>
                  <AppText color={colors.textSecondary} align="center">
                    {t("scheduled.board.noWindowsBody")}
                  </AppText>
                  <PrimaryButton
                    title={t("scheduled.board.setAvailability")}
                    size="large"
                    onPress={() => router.push("/availability-windows")}
                    testID="board-set-availability"
                  />
                </View>
              )
            ) : null}
            {board.status === "loaded" &&
            !board.blockedReason &&
            board.items.length > 0 ? (
              <>
                <AppText
                  variant="caption"
                  color={colors.textMuted}
                  testID="board-count"
                >
                  {t("scheduled.board.count", {
                    count: formatNumber(board.totalItems, language),
                  })}
                </AppText>
                {board.items.map((entry) => (
                  <BoardCard
                    key={entry.rideId}
                    entry={entry}
                    now={now}
                    claiming={claiming === entry.rideId}
                    disabled={claiming !== null}
                    onClaim={() => void claim(entry)}
                  />
                ))}
                {board.items.length < board.totalItems ? (
                  <TextButton
                    title={t("scheduled.board.more")}
                    onPress={() => void fetchBoard(board.page + 1)}
                    testID="board-more"
                  />
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <>
            <AppText variant="caption" color={colors.textMuted}>
              {t("scheduled.mine.intro")}
            </AppText>
            {mine.status === "loading" ? (
              <LoadingState testID="mine-loading" />
            ) : null}
            {mine.status === "error" ? (
              <FailureState
                kind={mine.kind}
                onRetry={() => {
                  setMine({ status: "loading" });
                  void fetchMine();
                }}
                testID="mine-error"
              />
            ) : null}
            {mine.status === "loaded" && mine.rides.length === 0 ? (
              <AppText
                color={colors.textSecondary}
                align="center"
                testID="mine-empty"
              >
                {t("scheduled.mine.empty")}
              </AppText>
            ) : null}
            {mine.status === "loaded"
              ? mine.rides.map((ride) => (
                  <ClaimedCard
                    key={ride.id}
                    ride={ride}
                    now={now}
                    onRelease={() => {
                      setReleaseError(null);
                      setReleasing(ride);
                    }}
                  />
                ))
              : null}
          </>
        )}
      </Screen>
      {releasing ? (
        <ReleaseSheet
          riderName={releasing.rider?.firstName?.trim() || t("ride.theRider")}
          when={formatWhen(
            releasing.scheduled?.scheduledAt ?? releasing.timeline.requestedAt,
            language,
          )}
          busy={releaseBusy}
          error={releaseError}
          onConfirm={(reason, note) => void release(reason, note)}
          onClose={() => setReleasing(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flex: 1 },
  rowReverse: { flexDirection: "row-reverse" },
  header: { gap: spacing.ms, paddingBottom: spacing.sm },
  headerRow: { flexDirection: "row", alignItems: "center" },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tabSelected: {
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 1,
  },
  card: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    gap: spacing.ms,
    marginBottom: spacing.ms,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  claimButton: { minWidth: 120 },
  reminder: { flexDirection: "row", alignItems: "center", gap: 6 },
  noticeWrap: { gap: spacing.xs, marginBottom: spacing.sm },
  empty: {
    alignItems: "stretch",
    gap: spacing.ms,
    paddingVertical: spacing.lg,
  },
  emptyIcon: {
    alignSelf: "center",
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
});
