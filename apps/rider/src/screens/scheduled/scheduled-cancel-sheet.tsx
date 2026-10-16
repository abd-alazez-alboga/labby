/**
 * Cancel a scheduled ride (UC-R-11) — approved artboard RiderSchedCancel:
 * the rides-v1 cancel, always free while the ride is still `scheduled`
 * (owner ruling 2026-10-16). The quote is still read first: a ride that
 * converted meanwhile (T − 15 min) follows RIDE-07 and its fee is shown
 * before confirming. A claiming driver is told by the backend.
 */
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ApiError } from "../../api/http-client";
import {
  cancelRide,
  type CancellationQuote,
  getCancellationQuote,
  type Ride,
} from "../../api/rides";
import { SCHEDULED_CANCEL_REASONS } from "../../api/scheduled-shared";
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
import { formatClock, formatMoney } from "../../ride/ride-format";
import { colors, spacing } from "../../theme/tokens";

type Reason = (typeof SCHEDULED_CANCEL_REASONS)[number];

export function ScheduledCancelSheet({
  ride,
  visible,
  onClose,
  onCancelled,
}: {
  ride: Ride;
  visible: boolean;
  onClose: () => void;
  onCancelled: (cancelled: Ride) => void;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
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
    getCancellationQuote(ride.id)
      .then((value) => {
        if (!cancelled) setQuote(value);
      })
      .catch((failure) => {
        if (cancelled) return;
        if (failure instanceof ApiError && failure.status === 409) {
          setError(t("cancel.notCancellable"));
        } else {
          setQuoteFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visible, ride.id, t]);

  const scheduledAt = ride.scheduled?.scheduledAt ?? null;
  const time = scheduledAt ? formatClock(scheduledAt, locale) : "";
  const driverName = ride.scheduled?.claimedBy?.firstName ?? null;
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
      const cancelled = await cancelRide(
        ride.id,
        reason,
        reason === "other" ? note.trim() : undefined,
      );
      onCancelled(cancelled);
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 409
          ? t("cancel.notCancellable")
          : t("scheduled.cancelFailed"),
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
      testID="scheduled-cancel-modal"
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.dismissArea}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("cancel.keep")}
        />
        <BottomSheet testID="scheduled-cancel-sheet">
          <ScrollView contentContainerStyle={styles.content}>
            <AppText variant="title">
              {t("scheduled.cancelTitle", { time })}
            </AppText>
            {quote ? (
              quote.free ? (
                <Banner
                  tone="neutral"
                  title={t("scheduled.cancelFreeTitle")}
                  message={
                    driverName
                      ? t("scheduled.cancelFreeBodyDriver", { name: driverName })
                      : t("scheduled.cancelFreeBody")
                  }
                  testID="scheduled-cancel-free"
                />
              ) : (
                <Banner
                  tone="warning"
                  message={
                    ride.paymentMethod === "wallet"
                      ? t("cancel.feeWalletNoTime", { money: feeMoney ?? "" })
                      : t("cancel.feeCarriedNoTime", { money: feeMoney ?? "" })
                  }
                  testID="scheduled-cancel-fee"
                />
              )
            ) : quoteFailed ? (
              <Banner
                tone="danger"
                message={t("cancel.quoteFailed")}
                testID="scheduled-cancel-quote-failed"
              />
            ) : !error ? (
              <AppText variant="secondary" tone="muted">
                {t("cancel.checking")}
              </AppText>
            ) : null}

            <AppText variant="label" weight={700} tone="secondary">
              {t("cancel.reasonLegend")}
            </AppText>
            <View accessibilityRole="radiogroup">
              {SCHEDULED_CANCEL_REASONS.map((item, index) => {
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
                      index < SCHEDULED_CANCEL_REASONS.length - 1 &&
                        styles.divider,
                    ]}
                    testID={`scheduled-cancel-reason-${item}`}
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
                testID="scheduled-cancel-note"
              />
            ) : null}
            {error ? (
              <Banner tone="danger" message={error} testID="scheduled-cancel-error" />
            ) : null}
          </ScrollView>
          <PrimaryButton
            label={t("cancel.keep")}
            onPress={onClose}
            testID="scheduled-cancel-keep"
          />
          <DestructiveTextButton
            label={
              feeMoney
                ? t("cancel.confirmFee", { money: feeMoney })
                : t("scheduled.confirmFree")
            }
            onPress={() => void confirm()}
            loading={busy}
            disabled={!quote && !quoteFailed}
            testID="scheduled-cancel-confirm"
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
  dismissArea: {
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
  flex: {
    flex: 1,
  },
});
