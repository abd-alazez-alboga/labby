import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import type { DriverRideContextValue } from "../../rides/DriverRideProvider";
import {
  formatDistance,
  formatMinutes,
  formatMoney,
  formatNumber,
} from "../../rides/format";
import { useNow } from "../../rides/use-now";
import { formatRating } from "../../trust/format";
import { colors, radius, spacing } from "../../theme/tokens";
import {
  AppText,
  Banner,
  Icon,
  PrimaryButton,
  SquareIconButton,
  useDirection,
} from "../ui";
import { CountdownRing, RouteSteps } from "./ride-parts";
import { seatsAndParties } from "./shared-parts";

/**
 * Design canvas "Driver offer" (UC-D-06): service type · payment chip, the
 * 15 s countdown ring from `expiresAt`, the estimated fare (big), pickup
 * distance / ETA + label, stops, destination, Decline (icon) + big Accept.
 * M11: the rider's rating ("rider rating 4.8 ★") joins the fare caption
 * when the daily snapshot has one (null below 5 ratings — nothing shown).
 * No trip length (the offer payload carries none).
 */
export function OfferCard({ ctx }: { ctx: DriverRideContextValue }) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const current = ctx.offer;
  const now = useNow(!!current);
  if (!current) return null;
  const { offer, deadline, windowMs } = current;
  const remainingMs = Math.max(0, deadline - now);
  const seconds = Math.ceil(remainingMs / 1000);
  const serviceName =
    language === "ar" ? offer.serviceTypeNameAr : offer.serviceTypeNameEn;
  const busy = ctx.pending === "accept" || ctx.pending === "decline";
  const error =
    ctx.error?.action === "accept" || ctx.error?.action === "decline"
      ? ctx.error
      : null;

  return (
    <View style={styles.card} testID="offer-card">
      <View style={[styles.header, flipRows && styles.rowReverse]}>
        <View style={styles.serviceChip}>
          <AppText
            variant="label"
            weight="800"
            color={colors.accent}
            testID="offer-service"
          >
            {offer.shared
              ? t("ride.shared.offerChip", { service: serviceName })
              : t("ride.offer.serviceAndPayment", {
                  service: serviceName,
                  payment: t(`ride.payment.${offer.paymentMethod}`),
                })}
          </AppText>
        </View>
        <CountdownRing
          fraction={windowMs > 0 ? remainingMs / windowMs : 0}
          label={formatNumber(seconds, language)}
          accessibilityLabel={t("ride.offer.secondsLeft", { count: seconds })}
          testID="offer-countdown"
        />
      </View>

      {offer.shared ? (
        <View
          style={[styles.sharedBlock, flipRows && styles.rowReverse]}
          testID="offer-shared"
        >
          <Icon name="people-outline" size={22} color={colors.accentPressed} />
          <View style={styles.grow}>
            <AppText
              variant="rowTitle"
              weight="800"
              color={colors.accentPressed}
              testID="offer-shared-seats"
            >
              {seatsAndParties(t, offer.shared.seats, offer.shared.parties, language)}
            </AppText>
            <AppText variant="caption" weight="400" color={colors.accentPressed}>
              {t("ride.shared.offerBody")}
            </AppText>
          </View>
        </View>
      ) : null}

      <View style={styles.fare}>
        <AppText variant="display" testID="offer-fare">
          {formatMoney(offer.estimatedFare, offer.currency, language)}
        </AppText>
        <AppText
          variant="secondary"
          color={colors.textSecondary}
          testID="offer-fare-caption"
        >
          {[
            offer.shared
              ? t("ride.shared.offerFare")
              : offer.surge
                ? t("ride.offer.estimatedFareSurge")
                : t("ride.offer.estimatedFare"),
            ...(!offer.shared && typeof offer.rider?.rating === "number"
              ? [
                  t("trust.offerRiderRating", {
                    rating: formatRating(offer.rider.rating, language),
                  }),
                ]
              : []),
          ].join(" · ")}
        </AppText>
      </View>

      <RouteSteps
        steps={[
          {
            key: "pickup",
            caption: t("ride.offer.pickupAway", {
              eta: formatMinutes(t, offer.pickupEtaSeconds, language),
              distance: formatDistance(t, offer.pickupDistanceMeters, language),
            }),
            place: offer.pickup,
            testID: "offer-pickup",
          },
          ...offer.stops.map((stop, index) => ({
            key: `stop-${index}`,
            caption: t("ride.stopN", { n: formatNumber(index + 1, language) }),
            place: stop,
            testID: `offer-stop-${index}`,
          })),
          {
            key: "destination",
            caption: t("ride.dropOff"),
            place: offer.destination,
            final: true,
            testID: "offer-destination",
          },
        ]}
      />

      {error ? (
        <Banner
          tone="danger"
          message={t(`ride.errors.${error.kind}`)}
          testID="offer-error"
        />
      ) : null}

      <View style={[styles.actions, flipRows && styles.rowReverse]}>
        <SquareIconButton
          icon="close"
          accessibilityLabel={t("ride.offer.decline")}
          onPress={() => void ctx.decline()}
          disabled={busy}
          busy={ctx.pending === "decline"}
          testID="offer-decline"
        />
        <View style={styles.grow}>
          <PrimaryButton
            title={t("ride.offer.accept")}
            size="large"
            onPress={() => void ctx.accept()}
            disabled={busy}
            busy={ctx.pending === "accept"}
            testID="offer-accept"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.ms,
    backgroundColor: colors.surface,
    borderRadius: radius.sheet,
    padding: spacing.ml,
    gap: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 32,
    elevation: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.ms,
  },
  rowReverse: { flexDirection: "row-reverse" },
  serviceChip: {
    flexShrink: 1,
    backgroundColor: colors.accentTint,
    paddingHorizontal: spacing.ms,
    paddingVertical: 6,
    borderRadius: 14,
  },
  fare: { gap: 2 },
  actions: { flexDirection: "row", gap: 10, alignItems: "center" },
  grow: { flex: 1 },
  sharedBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.accentTint,
    borderRadius: radius.md,
    paddingVertical: spacing.ms,
    paddingHorizontal: 14,
  },
});
