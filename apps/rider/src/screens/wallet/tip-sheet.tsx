/**
 * Tip sheet (PAY-04, UC-R-08) — approved artboard RiderTip: suggested chips
 * per currency (SYP 2,000 / 5,000 / 10,000; other currencies: custom amount
 * only) + a custom amount (Western, Arabic-Indic or Eastern Arabic-Indic
 * digits, grouping separators ignored, "." or "٫" decimal, max 2 dp), the wallet balance line, the
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
import type { Place } from "../../api/rides";
import {
  formatDateTime,
  formatDayDate,
  formatMoney,
  placeLabel,
} from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";

/**
 * Suggested tip amounts per currency (a client concern per money-v1.yaml).
 * The middle chip starts selected; a currency missing here gets no chips —
 * custom amount only.
 */
export const SUGGESTED_TIPS: Readonly<Record<string, readonly number[]>> = {
  SYP: [2000, 5000, 10000],
};

/** The suggested chips for a currency (empty when it has none). */
/**
 * The tip sheet's ride line, the same from every entry point (approved
 * artboard RiderTip): "Wed 8 Oct · Umayyad Square · SYP 27,250" — the
 * total is left out while the ride is still running.
 */
export function tipRideLine(
  ride: {
    at: string;
    destination: Place;
    total?: number | null;
    currency: string;
  },
  locale: "en" | "ar",
  t: (key: string, options?: object) => string,
): string {
  return [
    formatDayDate(ride.at, locale),
    placeLabel(ride.destination),
    ride.total != null
      ? formatMoney(ride.total, ride.currency, locale, t)
      : null,
  ]
    .filter((part): part is string => !!part)
    .join(" · ");
}

export function suggestedTips(currency: string): readonly number[] {
  return SUGGESTED_TIPS[currency] ?? [];
}

/** Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits → 0-9. */
function westernDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * Parses a typed tip: any digit script, grouping separators ("," "٬" and
 * spaces) ignored, "." or "٫" as the decimal mark, at most 2 decimals.
 * Null when it is not a positive amount.
 */
export function parseTipAmount(text: string): number | null {
  const normalized = westernDigits(text)
    .replace(/[,\u066C\s\u00A0\u202F]/g, "")
    .replace(/\u066B/g, ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

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
  onAlreadyTipped,
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
  /**
   * Called (and the sheet closes) on a 409 `already_tipped` — the ride was
   * tipped elsewhere, so the caller hides its entry. Without it the sheet
   * shows the already-tipped message like the other 409s.
   */
  onAlreadyTipped?: () => void;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const [balance, setBalance] = useState<number | null>(null);
  const chips = suggestedTips(currency);
  const [selected, setSelected] = useState<number | null>(
    chips.length ? chips[Math.floor(chips.length / 2)] : null,
  );
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

  const hasCustom = custom.trim() !== "";
  const customAmount = hasCustom ? parseTipAmount(custom) : null;
  const amount = hasCustom ? customAmount : selected;

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
      const key = tipErrorKey(failure);
      if (key === "alreadyTipped" && onAlreadyTipped) {
        onAlreadyTipped();
        onClose();
        return;
      }
      setError(t(`tip.errors.${key}`));
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

          {chips.length ? (
            <View style={[styles.chips, { flexDirection: row }]}>
              {chips.map((value) => {
                const isSelected = !hasCustom && selected === value;
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
          ) : null}

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
            error={hasCustom && customAmount === null ? t("tip.invalidAmount") : null}
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
