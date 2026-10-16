/**
 * Leave a dispatched shared ride (UC-R-14 E1, RIDE-P5) — approved artboard
 * RiderSharedLeave: `GET /shared-rides/{id}/leave-quote` first (free before
 * acceptance and within the grace, the region's fee after it — RIDE-07 per
 * member), a reason (`other` needs a note), "Stay in the ride" as the
 * primary action. Leaving ends the ride for this member only — the others
 * keep riding; `in_progress` can't be left.
 */
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ApiError } from "../../api/http-client";
import { type CancellationQuote, type Ride, rideErrorCode } from "../../api/rides";
import {
  getLeaveQuote,
  leaveSharedRide,
  SHARED_LEAVE_REASONS,
} from "../../api/scheduled-shared";
import {
  AppText,
  Banner,
  BottomSheet,
  DestructiveTextButton,
  PrimaryButton,
  TextField,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { useActiveRide } from "../../ride/ride-context";
import { formatClock, formatMoney } from "../../ride/ride-format";
import { colors, spacing } from "../../theme/tokens";

type Reason = (typeof SHARED_LEAVE_REASONS)[number];

export function SharedLeaveSheet({
  ride,
  visible,
  onClose,
}: {
  ride: Ride;
  visible: boolean;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const { markLeft } = useActiveRide();
  const [quote, setQuote] = useState<CancellationQuote | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [reason, setReason] = useState<Reason>("changed_mind");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    getLeaveQuote(ride.id)
      .then((value) => {
        if (!cancelled) setQuote(value);
      })
      .catch((failure) => {
        if (cancelled) return;
        if (failure instanceof ApiError && failure.status === 409) {
          setError(t("shared.notLeavable"));
        } else {
          setQuoteFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visible, ride.id, t]);

  const currency = quote?.currency ?? ride.estimate.components.currency;
  const feeMoney =
    quote && !quote.free && quote.fee != null
      ? formatMoney(quote.fee, currency, locale, t)
      : null;

  const confirm = async () => {
    if (reason === "other" && !note.trim()) {
      setNoteError(t("cancel.noteRequired"));
      return;
    }
    setNoteError(null);
    setError(null);
    setBusy(true);
    try {
      const left = await leaveSharedRide(
        ride.id,
        reason,
        reason === "other" ? note.trim() : undefined,
      );
      markLeft(left.me?.cancellationFee ?? null);
      onClose();
    } catch (failure) {
      setError(
        rideErrorCode(failure) === "illegal_state"
          ? t("shared.notLeavable")
          : t("shared.actionFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="shared-leave-modal"
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.flex}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("shared.stay")}
        />
        <BottomSheet testID="shared-leave-sheet">
          <ScrollView contentContainerStyle={styles.content}>
            <AppText variant="title">{t("shared.leaveTitle")}</AppText>
            {quote ? (
              quote.free ? (
                <Banner
                  tone="success"
                  title={t("shared.leaveFreeTitle")}
                  message={t("shared.leaveFreeBody")}
                  testID="shared-leave-free"
                />
              ) : (
                <Banner
                  tone="warning"
                  title={t("shared.leaveFeeTitle", { money: feeMoney ?? "" })}
                  message={
                    quote.graceEndsAt
                      ? t("shared.leaveFeeBody", {
                          time: formatClock(quote.graceEndsAt, locale),
                        })
                      : t("shared.leaveFeeBodyNoTime")
                  }
                  testID="shared-leave-fee"
                />
              )
            ) : quoteFailed ? (
              <Banner
                tone="danger"
                message={t("cancel.quoteFailed")}
                testID="shared-leave-quote-failed"
              />
            ) : !error ? (
              <AppText variant="secondary" tone="muted">
                {t("cancel.checking")}
              </AppText>
            ) : null}
            <AppText variant="label" weight={700} tone="secondary">
              {t("shared.leaveReasonLegend")}
            </AppText>
            <View accessibilityRole="radiogroup">
              {SHARED_LEAVE_REASONS.map((item, index) => {
                const selected = item === reason;
                return (
                  <Pressable
                    key={item}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => setReason(item)}
                    style={[
                      styles.reason,
                      { flexDirection: row },
                      index < SHARED_LEAVE_REASONS.length - 1 && styles.divider,
                    ]}
                    testID={`shared-leave-reason-${item}`}
                  >
                    <View style={[styles.radio, selected && styles.radioOn]}>
                      {selected ? <View style={styles.radioDot} /> : null}
                    </View>
                    <AppText variant="bodyStrong" style={styles.flex}>
                      {t(`cancel.reasons.${item}`)}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
            {reason === "other" ? (
              <TextField
                label={t("cancel.noteLabel")}
                value={note}
                onChangeText={setNote}
                maxLength={500}
                error={noteError}
                testID="shared-leave-note"
              />
            ) : null}
            {error ? (
              <Banner tone="danger" message={error} testID="shared-leave-error" />
            ) : null}
          </ScrollView>
          <PrimaryButton
            label={t("shared.stay")}
            onPress={onClose}
            testID="shared-leave-stay"
          />
          <DestructiveTextButton
            label={
              feeMoney
                ? t("shared.leaveConfirmFee", { money: feeMoney })
                : t("shared.leaveConfirmFree")
            }
            onPress={() => void confirm()}
            loading={busy}
            disabled={!quote && !quoteFailed}
            testID="shared-leave-confirm"
          />
        </BottomSheet>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20,16,24,0.48)",
  },
  flex: {
    flex: 1,
  },
  content: {
    gap: 14,
  },
  reason: {
    alignItems: "center",
    gap: spacing.md,
    minHeight: 52,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: {
    borderColor: colors.accent,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
});
