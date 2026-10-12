/**
 * Tip sheet (PAY-04, UC-R-08) — approved artboard RiderTip: suggested chips
 * (2,000 / 5,000 / 10,000) + a custom amount, the wallet balance line, the
 * tip-window line, "100% goes to the driver", and a primary button naming
 * the amount. Wallet-only; one tip per ride. The contract's 409s (window
 * expired / already tipped / insufficient balance / not tippable) each get
 * their own message, and an insufficient balance is caught client-side
 * before posting when the balance is known.
 */
import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { getWallet, tipErrorKey, tipRide, type TipResponse } from "../../api/wallet";
import {
  AppText,
  Banner,
  BottomSheet,
  PrimaryButton,
  TextButton,
  TextField,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { formatDateTime, formatMoney } from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";

/** Suggested tip amounts (a client concern per money-v1.yaml). */
export const SUGGESTED_TIPS = [2000, 5000, 10000] as const;

function initial(name: string | null): string {
  return name?.trim().charAt(0).toUpperCase() || "?";
}

export function TipSheet({
  visible,
  onClose,
  rideId,
  currency,
  driverName,
  completedAt,
  rideLine,
  onTipped,
}: {
  visible: boolean;
  onClose: () => void;
  rideId: string;
  /** The ride's currency (the tip is debited in it). */
  currency: string;
  driverName: string | null;
  /** Null while the ride is still in progress (window not started). */
  completedAt: string | null;
  /** "Wed 8 Oct · Umayyad Square · SYP 27,250" under the title. */
  rideLine?: string | null;
  /** Called with the applied tip; the caller updates its own view. */
  onTipped: (tip: TipResponse) => void;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const [balance, setBalance] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(SUGGESTED_TIPS[1]);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    getWallet()
      .then((wallet) => {
        if (cancelled) return;
        const entry = wallet.balances.find(
          (item) => item.currency === currency,
        );
        setBalance(entry?.balance ?? 0);
      })
      .catch(() => {
        // Balance line stays hidden; the backend still validates the tip.
      });
    return () => {
      cancelled = true;
    };
  }, [visible, currency]);

  const customAmount = custom.trim() ? Number(custom.replace(",", ".")) : null;
  const amount =
    customAmount !== null
      ? Number.isFinite(customAmount) && customAmount > 0
        ? customAmount
        : null
      : selected;

  const deadline = completedAt
    ? Date.parse(completedAt) + 24 * 60 * 60 * 1000
    : null;

  const send = async () => {
    if (amount === null) {
      setError(t("tip.invalidAmount"));
      return;
    }
    if (balance !== null && amount > balance) {
      setError(t("tip.errors.insufficientBalance"));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const tip = await tipRide(rideId, amount);
      onTipped(tip);
      onClose();
    } catch (failure) {
      setError(t(`tip.errors.${tipErrorKey(failure)}`));
    } finally {
      setBusy(false);
    }
  };

  const title = driverName
    ? t("tip.title", { name: driverName })
    : t("tip.titleNoName");
  const moneyFor = (value: number) => formatMoney(value, currency, locale, t);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="tip-sheet-modal"
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.dismissArea}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("tip.notNow")}
        />
        <BottomSheet testID="tip-sheet">
          <View style={[styles.header, { flexDirection: row }]}>
            <View style={styles.avatar}>
              <AppText variant="heading" tone="accent" align="center">
                {initial(driverName)}
              </AppText>
            </View>
            <View style={styles.headerText}>
              <AppText variant="title" testID="tip-title">
                {title}
              </AppText>
              {rideLine ? (
                <AppText variant="caption" tone="muted" weight={400}>
                  {rideLine}
                </AppText>
              ) : null}
            </View>
          </View>

          <View style={[styles.chips, { flexDirection: row }]}>
            {SUGGESTED_TIPS.map((value) => {
              const isSelected = customAmount === null && selected === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  onPress={() => {
                    setSelected(value);
                    setCustom("");
                  }}
                  style={[styles.chip, isSelected && styles.chipSelected]}
                  testID={`tip-amount-${value}`}
                >
                  <AppText
                    variant="bodyStrong"
                    weight={800}
                    tone={isSelected ? "onAccent" : "default"}
                  >
                    {new Intl.NumberFormat(`${locale}-u-nu-latn`).format(value)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <TextField
            label={t("tip.customLabel", {
              currency: t(`money.currencies.${currency}`, {
                defaultValue: currency,
              }),
            })}
            value={custom}
            onChangeText={setCustom}
            keyboardType="numeric"
            placeholder="0"
            testID="tip-custom"
          />

          <View style={styles.facts}>
            {balance !== null ? (
              <View style={[styles.fact, { flexDirection: row }]}>
                <Ionicons name="wallet-outline" size={18} color={colors.text} />
                <AppText
                  variant="secondary"
                  tone="secondary"
                  style={styles.flex}
                  testID="tip-balance"
                >
                  {t("tip.fromWallet", { money: moneyFor(balance) })}
                </AppText>
              </View>
            ) : null}
            <View style={[styles.fact, { flexDirection: row }]}>
              <Ionicons name="time-outline" size={18} color={colors.text} />
              <AppText
                variant="secondary"
                tone="secondary"
                style={styles.flex}
                testID="tip-window"
              >
                {deadline
                  ? t("tip.window", {
                      time: formatDateTime(
                        new Date(deadline).toISOString(),
                        locale,
                      ),
                    })
                  : t("tip.windowDuringRide")}
              </AppText>
            </View>
            <View style={[styles.fact, { flexDirection: row }]}>
              <Ionicons name="heart-outline" size={18} color={colors.accent} />
              <AppText
                variant="secondary"
                tone="secondary"
                style={styles.flex}
              >
                {driverName
                  ? t("tip.allToDriver", { name: driverName })
                  : t("tip.allToDriverNoName")}
              </AppText>
            </View>
          </View>

          {error ? (
            <Banner tone="danger" message={error} testID="tip-error" />
          ) : null}

          <PrimaryButton
            label={t("tip.send", {
              money: amount !== null ? moneyFor(amount) : "—",
            })}
            onPress={() => void send()}
            loading={busy}
            disabled={amount === null}
            testID="tip-send"
          />
          <TextButton
            label={t("tip.notNow")}
            onPress={onClose}
            testID="tip-not-now"
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
  header: {
    alignItems: "center",
    gap: 14,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.round,
    backgroundColor: colors.surfaceMap,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  chips: {
    gap: spacing.sm,
  },
  chip: {
    flex: 1,
    height: 56,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  chipSelected: {
    borderColor: colors.text,
    backgroundColor: colors.text,
  },
  facts: {
    gap: spacing.sm,
  },
  fact: {
    alignItems: "center",
    gap: 10,
    minHeight: 24,
  },
  flex: {
    flex: 1,
  },
});
