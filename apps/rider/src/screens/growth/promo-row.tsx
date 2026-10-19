/**
 * Promo code entry for the booking surfaces (UC-R-04 A1, GRW-01/02) —
 * approved artboards R13PromoChoose and R13PromoErrors:
 * - no code: an "Add a promo code" row opening the full-screen entry
 *   (input + Apply, ONE refusal message at a time from the contract codes);
 * - applied: the accent chip with the code, its terms and Remove. The
 *   estimate stays promo-free — the discount lands on the receipt; a
 *   scheduled booking's amount is worked out at ride time (ruling 3) and a
 *   shared ride discounts only the member's own seat (ruling 2), which the
 *   chip copy says per variant.
 * While a promo is applied, a context change (another service type picked)
 * re-validates it; a refusal drops the chip and explains inline.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  promoErrorKey,
  type PromoValidation,
  validatePromo,
} from "../../api/growth";
import {
  AppText,
  PrimaryButton,
  TextButton,
  TextField,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import type { AppLocale } from "../../i18n/translations";
import { formatMoney, formatPoints } from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";

type T = (key: string, params?: Record<string, unknown>) => string;

/** Which booking surface the row sits on — picks the chip's suffix copy. */
export type PromoVariant = "onDemand" | "scheduled" | "shared";

/** The validate context of the surface's current selection. */
export interface PromoContext {
  regionId: string;
  serviceTypeId: string;
  currency: string;
  /** The selected option's estimate; omitted for a scheduled booking. */
  estimateTotal?: number;
  /** Present for a scheduled booking (ruling 3). */
  scheduledAt?: string;
}

/** "20% off, up to SYP 10,000" / "SYP 5,000 off" — the promo's terms. */
export function promoTerms(
  promo: PromoValidation,
  currency: string,
  locale: AppLocale,
  t: T,
): string {
  if (promo.type === "percent") {
    const percent = formatPoints(promo.value, locale);
    return promo.maxDiscount != null
      ? t("growth.promo.terms.percentCapped", {
          percent,
          money: formatMoney(promo.maxDiscount, currency, locale, t),
        })
      : t("growth.promo.terms.percent", { percent });
  }
  return t("growth.promo.terms.fixed", {
    money: formatMoney(promo.value, currency, locale, t),
  });
}

/**
 * The copy of a refused promo (validate or booking), or null when the error
 * is not about the promo — booking screens try this first and fall back to
 * their own error handling.
 */
export function promoErrorMessage(error: unknown, t: T): string | null {
  const key = promoErrorKey(error);
  return key ? t(`growth.promo.errors.${key}`) : null;
}

const VARIANT_SUFFIX: Record<PromoVariant, string> = {
  onDemand: "growth.promo.appliedFinalFare",
  scheduled: "growth.promo.appliedAtRideTime",
  shared: "growth.promo.appliedSharedSeat",
};

export function PromoRow({
  context,
  variant,
  promo,
  onChange,
  externalError = null,
  testID = "promo",
}: {
  context: PromoContext;
  variant: PromoVariant;
  /** The applied promo, held by the booking surface (sent at booking). */
  promo: PromoValidation | null;
  onChange: (promo: PromoValidation | null) => void;
  /**
   * A refusal the SURFACE got at booking time (M13 review W9): shown in the
   * row's error slot after the surface cleared the promo, so the next tap
   * books without it (UC-R-04 A1).
   */
  externalError?: string | null;
  testID?: string;
}) {
  const { t, locale } = useLocale();
  const { row, backChevron } = useDirection();
  const { top } = useSafeAreaInsets();
  const [entryOpen, setEntryOpen] = useState(false);
  const [code, setCode] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // The applied code was refused on a context re-check: explained inline.
  const [rowError, setRowError] = useState<string | null>(null);

  const validatedFor = useRef<string | null>(null);
  const contextKey = `${context.regionId}|${context.serviceTypeId}|${context.estimateTotal ?? ""}|${context.scheduledAt ?? ""}`;

  // The contract request (growth-v1 ValidatePromoRequest) — `currency` is
  // display-only and stays out of the payload.
  const request = (forCode: string) => ({
    code: forCode,
    regionId: context.regionId,
    serviceTypeId: context.serviceTypeId,
    ...(context.estimateTotal !== undefined
      ? { estimateTotal: context.estimateTotal }
      : {}),
    ...(context.scheduledAt ? { scheduledAt: context.scheduledAt } : {}),
  });

  // Re-validate the applied promo when the selection changes (e.g. another
  // service type): terms/preview may differ, or the code may not apply.
  useEffect(() => {
    if (!promo || validatedFor.current === contextKey) return;
    let cancelled = false;
    validatePromo(request(promo.code))
      .then((next) => {
        if (cancelled) return;
        validatedFor.current = contextKey;
        onChange(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        validatedFor.current = contextKey;
        const message = promoErrorMessage(error, t);
        if (message) {
          onChange(null);
          setRowError(message);
        }
        // Network trouble: keep the promo — booking re-validates anyway.
      });
    return () => {
      cancelled = true;
    };
    // contextKey covers every context field the call uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey, promo?.code]);

  const apply = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setChecking(true);
    setEntryError(null);
    try {
      const validated = await validatePromo(request(trimmed));
      validatedFor.current = contextKey;
      onChange(validated);
      setRowError(null);
      setEntryOpen(false);
      setCode("");
    } catch (error) {
      setEntryError(
        promoErrorMessage(error, t) ?? t("growth.promo.errors.generic"),
      );
    } finally {
      setChecking(false);
    }
  };

  const entry = (
    <Modal
      visible={entryOpen}
      animationType="slide"
      onRequestClose={() => setEntryOpen(false)}
      testID={`${testID}-entry-modal`}
    >
      <View style={[styles.entry, { paddingTop: top + spacing.sm }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          onPress={() => setEntryOpen(false)}
          style={styles.back}
          testID={`${testID}-entry-back`}
        >
          <Ionicons name={backChevron} size={22} color={colors.text} />
        </Pressable>
        <AppText variant="title">{t("growth.promo.entryTitle")}</AppText>
        <View style={[styles.entryRow, { flexDirection: row }]}>
          <View style={styles.flex}>
            <TextField
              label={t("growth.promo.codeLabel")}
              value={code}
              onChangeText={(next) => {
                setCode(next);
                setEntryError(null);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              error={entryError}
              testID={`${testID}-input`}
            />
          </View>
          <PrimaryButton
            label={t("growth.promo.apply")}
            onPress={() => void apply()}
            disabled={!code.trim()}
            loading={checking}
            style={styles.apply}
            testID={`${testID}-apply`}
          />
        </View>
        <View style={[styles.note, { flexDirection: row }]}>
          <Ionicons
            name="information-circle-outline"
            size={18}
            color={colors.textSecondary}
          />
          <AppText
            variant="caption"
            tone="secondary"
            weight={400}
            style={styles.flex}
          >
            {t("growth.promo.note")}
          </AppText>
        </View>
      </View>
    </Modal>
  );

  if (promo) {
    return (
      <View style={styles.block}>
        <View
          style={[styles.chip, { flexDirection: row }]}
          testID={`${testID}-applied`}
        >
          <Ionicons name="pricetag-outline" size={20} color={colors.accent} />
          <View style={styles.flex}>
            <AppText
              variant="label"
              weight={800}
              tone="accent"
              testID={`${testID}-code`}
            >
              {t("growth.promo.appliedTitle", { code: promo.code })}
            </AppText>
            <AppText variant="caption" weight={400} tone="accent">
              {t(VARIANT_SUFFIX[variant], {
                terms: promoTerms(promo, context.currency, locale, t),
              })}
            </AppText>
            {promo.discountPreview != null && promo.discountPreview > 0 ? (
              // M13 review W12 (owner-approved board amendment): the
              // server's preview against the chosen option's estimate.
              <AppText
                variant="caption"
                weight={400}
                tone="secondary"
                testID={`${testID}-preview`}
              >
                {t("growth.promo.estimatePreview", {
                  money: formatMoney(
                    promo.discountPreview,
                    context.currency,
                    locale,
                    t,
                  ),
                })}
              </AppText>
            ) : null}
          </View>
          <TextButton
            label={t("growth.promo.remove")}
            onPress={() => {
              onChange(null);
              setRowError(null);
            }}
            testID={`${testID}-remove`}
          />
        </View>
        {entry}
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setEntryError(null);
          setEntryOpen(true);
        }}
        style={({ pressed }) => [
          styles.addRow,
          { flexDirection: row },
          pressed && styles.pressed,
        ]}
        testID={`${testID}-add`}
      >
        <Ionicons name="pricetag-outline" size={20} color={colors.text} />
        <AppText variant="bodyStrong" style={styles.flex}>
          {t("growth.promo.addRow")}
        </AppText>
        <AppText variant="label" weight={700} tone="accent">
          {t("growth.promo.addAction")}
        </AppText>
      </Pressable>
      {(rowError ?? externalError) ? (
        <AppText
          variant="caption"
          weight={700}
          tone="danger"
          testID={`${testID}-row-error`}
        >
          {rowError ?? externalError}
        </AppText>
      ) : null}
      {entry}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.xs,
  },
  addRow: {
    alignItems: "center",
    gap: 10,
    minHeight: 48,
  },
  chip: {
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.accentTint,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
  },
  entry: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  back: {
    width: 48,
    height: 48,
    marginStart: -12,
    alignItems: "center",
    justifyContent: "center",
  },
  entryRow: {
    gap: spacing.sm,
    alignItems: "flex-end",
  },
  apply: {
    minWidth: 96,
  },
  note: {
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.chip,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
  },
  flex: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
