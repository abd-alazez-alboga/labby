/**
 * Rider cancellation (UC-R-09, RIDE-07) — approved artboard RiderCancel:
 * before confirming, `GET /rides/{id}/cancellation-quote` says whether it is
 * free or which fee would be recorded (worded by the ride's payment method:
 * wallet rides pay it from the wallet, cash rides carry it to the next
 * ride); the rider picks a reason
 * (`other` needs a note); "Keep my ride" is the primary action.
 */
import React, { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ApiError } from "../../api/http-client";
import {
  type CancellationQuote,
  getCancellationQuote,
  RIDER_CANCEL_REASONS,
  type Ride,
  type RiderCancelReason,
} from "../../api/rides";
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

export function CancelSheet({
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
  const { cancel, resync } = useActiveRide();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const [quote, setQuote] = useState<CancellationQuote | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [reason, setReason] = useState<RiderCancelReason>("changed_mind");
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
        if (
          failure instanceof ApiError &&
          failure.status === 403 &&
          failure.body?.code === "account_suspended"
        ) {
          // M11 (R-N1): the account's suspension already ended this search —
          // the resync shows it ended for that reason.
          closeRef.current();
          void resync();
          return;
        }
        if (failure instanceof ApiError && failure.status === 409) {
          setError(t("cancel.notCancellable"));
        } else {
          setQuoteFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visible, ride.id, t, resync]);

  const currency =
    quote?.currency ?? ride.estimate.components.currency;
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
      await cancel(reason, reason === "other" ? note.trim() : undefined);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 409
          ? t("cancel.notCancellable")
          : t("cancel.failed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const graceEnd = ride.cancellationGraceEndsAt
    ? formatClock(ride.cancellationGraceEndsAt, locale)
    : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="cancel-sheet-modal"
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.dismissArea}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("cancel.keep")}
        />
        <BottomSheet testID="cancel-sheet">
          <ScrollView contentContainerStyle={styles.content}>
            <AppText variant="title">{t("cancel.title")}</AppText>
            {quote ? (
              quote.free ? (
                <Banner
                  tone="success"
                  title={t("cancel.freeTitle")}
                  message={
                    quote.graceEndsAt
                      ? t("cancel.freeUntil", {
                          time: formatClock(quote.graceEndsAt, locale),
                        })
                      : t("cancel.freeBody")
                  }
                  testID="cancel-quote-free"
                />
              ) : (
                // M8 (approved artboard RiderCancelFee): past the grace a
                // cash ride's fee is carried — "added to your next ride"
                // (rider dues); a wallet ride's fee is taken from the
                // wallet now and only the uncovered rest is carried.
                <Banner
                  tone="warning"
                  message={
                    ride.paymentMethod === "wallet"
                      ? graceEnd
                        ? t("cancel.feeWallet", {
                            time: graceEnd,
                            money: feeMoney ?? "",
                          })
                        : t("cancel.feeWalletNoTime", { money: feeMoney ?? "" })
                      : graceEnd
                        ? t("cancel.feeCarried", {
                            time: graceEnd,
                            money: feeMoney ?? "",
                          })
                        : t("cancel.feeCarriedNoTime", { money: feeMoney ?? "" })
                  }
                  testID="cancel-quote-fee"
                />
              )
            ) : quoteFailed ? (
              <Banner
                tone="danger"
                message={t("cancel.quoteFailed")}
                testID="cancel-quote-failed"
              />
            ) : !error ? (
              <AppText variant="secondary" tone="muted" testID="cancel-quote-loading">
                {t("cancel.checking")}
              </AppText>
            ) : null}

            <AppText variant="label" weight={700} tone="secondary">
              {t("cancel.reasonLegend")}
            </AppText>
            <View accessibilityRole="radiogroup">
              {RIDER_CANCEL_REASONS.map((item, index) => {
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
                      index < RIDER_CANCEL_REASONS.length - 1 && styles.divider,
                    ]}
                    testID={`cancel-reason-${item}`}
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
                testID="cancel-note"
              />
            ) : null}
            {error ? (
              <Banner tone="danger" message={error} testID="cancel-error" />
            ) : null}
          </ScrollView>
          <PrimaryButton
            label={t("cancel.keep")}
            onPress={onClose}
            testID="cancel-keep"
          />
          <DestructiveTextButton
            label={
              feeMoney
                ? t("cancel.confirmFee", { money: feeMoney })
                : t("cancel.confirmFree")
            }
            onPress={() => void confirm()}
            loading={busy}
            disabled={!quote && !quoteFailed}
            testID="cancel-confirm"
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
