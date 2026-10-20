import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet, View } from "react-native";

import { getMyDocuments } from "../../api/onboarding";
import type { DocumentSlot } from "../../api/onboarding-types";
import { DOCUMENT_TYPES } from "../../api/onboarding-types";
import { useLocale } from "../../i18n/LocaleProvider";
import { pluralCategory } from "../../money/format";
import { daysUntil, formatDate } from "../../onboarding/dates";
import { useRemote } from "../../onboarding/use-remote";
import { colors, radius, spacing } from "../../theme/tokens";
import {
  Banner,
  BodyText,
  FailureState,
  ListRow,
  LoadingState,
  Muted,
  PrimaryButton,
  Screen,
  StatusChip,
} from "../ui";

const NOT_APPROVED = [409] as const;

/** DRV-04: the first expiry reminder goes out 30 days ahead — "Renew soon" from then. */
export const RENEW_SOON_DAYS = 30;

/** Days left on a not-yet-expired document inside the DRV-04 horizon, else null. */
export function renewSoonDays(
  slot: DocumentSlot,
  now: Date = new Date(),
): number | null {
  if (slot.expired) return null;
  const days = daysUntil(slot.current.expiresOn, now);
  return days >= 0 && days <= RENEW_SOON_DAYS ? days : null;
}

function SlotRow({
  slot,
  focused,
  last,
}: {
  slot: DocumentSlot;
  focused: boolean;
  last: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { language } = useLocale();
  const { current, renewal } = slot;
  const pending = renewal?.reviewStatus === "pending";
  const rejected = renewal?.reviewStatus === "rejected";
  const name = t(`onboarding.documentTypes.${slot.type}`);
  const soon = renewSoonDays(slot) !== null;
  // Board DriverDocuments: the row says when, nothing else (I66).
  const validity = `${t(
    slot.expired
      ? "onboarding.documents.expiredOn"
      : soon
        ? "onboarding.documents.expires"
        : "onboarding.documents.validThrough",
  )} ${formatDate(current.expiresOn, language)}`;

  return (
    <View
      style={focused ? styles.focused : null}
      testID={focused ? `slot-${slot.type}-focused` : undefined}
    >
      <View testID={`slot-${slot.type}`}>
        <ListRow
          title={name}
          subtitle={validity}
          subtitleColor={
            slot.expired ? colors.danger : soon ? colors.warning : undefined
          }
          trailing={
            slot.expired ? (
              <StatusChip
                label={t("onboarding.documents.expired")}
                tone="danger"
                testID={`slot-${slot.type}-expired`}
              />
            ) : soon ? (
              <StatusChip
                label={t("onboarding.documents.renewSoon")}
                tone="warning"
                testID={`slot-${slot.type}-soon`}
              />
            ) : (
              <StatusChip
                label={t("onboarding.documents.valid")}
                tone="success"
              />
            )
          }
          chevron
          onPress={() =>
            router.push({
              pathname: "/renew-document",
              params: { type: slot.type },
            })
          }
          disabled={pending}
          accessibilityLabel={`${t("onboarding.documents.renew")} — ${name}`}
          last={last}
          testID={`slot-${slot.type}-renew`}
        >
          {pending && renewal ? (
            <View style={styles.renewal} testID={`slot-${slot.type}-pending`}>
              <StatusChip
                label={t("onboarding.documents.renewalPending")}
                tone="warning"
              />
              <Muted>
                {t("onboarding.documents.renewalPendingHint", {
                  date: formatDate(renewal.expiresOn, language),
                })}
              </Muted>
            </View>
          ) : null}
          {rejected && renewal ? (
            <Banner
              tone="warning"
              title={t("onboarding.documents.renewalRejected")}
              message={renewal.reviewNote ?? t("onboarding.documents.noReason")}
              testID={`slot-${slot.type}-rejected`}
            />
          ) : null}
        </ListRow>
      </View>
    </View>
  );
}

/**
 * UC-D-19 — the four current documents with expiry and renewal state; the
 * entry point for renewing (also from the expiry-suspension state). Each
 * row opens its renewal; an expired document's renewal is pinned below,
 * else the soonest one inside the DRV-04 30-day horizon (W19, board
 * DriverDocuments: "Renew soon" chip, banner and "Renew {document}").
 */
export function DocumentsScreen() {
  const { t } = useTranslation();
  const { language } = useLocale();
  const router = useRouter();
  const { state, refreshing, reload } = useRemote(getMyDocuments, NOT_APPROVED);
  // Set when a notification deep link (driver_documents) names a document.
  const { documentType } = useLocalSearchParams<{ documentType?: string }>();

  const ordered =
    state.status === "loaded"
      ? [...state.data].sort(
          (a, b) =>
            DOCUMENT_TYPES.indexOf(a.type) - DOCUMENT_TYPES.indexOf(b.type),
        )
      : [];
  const anyExpired = ordered.some((slot) => slot.expired);
  const renewable = ordered.filter(
    (slot) => slot.renewal?.reviewStatus !== "pending",
  );
  // The soonest renewable document inside the 30-day horizon.
  const expiring = renewable
    .map((slot) => ({ slot, days: renewSoonDays(slot) }))
    .filter((entry): entry is { slot: DocumentSlot; days: number } =>
      entry.days !== null,
    )
    .sort((a, b) => a.days - b.days)[0];
  const renewFirst =
    renewable.find((slot) => slot.expired) ?? expiring?.slot ?? null;

  return (
    <Screen
      title={t("onboarding.documents.title")}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void reload()}
        />
      }
      footer={
        renewFirst ? (
          <PrimaryButton
            title={t("onboarding.documents.renewNamed", {
              document: t(`onboarding.documentTypes.${renewFirst.type}`),
            })}
            onPress={() =>
              router.push({
                pathname: "/renew-document",
                params: { type: renewFirst.type },
              })
            }
            testID="documents-renew-primary"
          />
        ) : undefined
      }
      testID="documents-screen"
    >
      {state.status === "loading" ? <LoadingState /> : null}
      {state.status === "error" ? (
        <FailureState kind={state.kind} onRetry={() => void reload()} />
      ) : null}
      {state.status === "absent" ? (
        <BodyText testID="documents-not-approved">
          {t("onboarding.documents.notApproved")}
        </BodyText>
      ) : null}
      {state.status === "loaded" ? (
        <>
          {anyExpired ? (
            <Banner
              tone="danger"
              message={t("onboarding.documents.expiredBanner")}
              testID="documents-expired-banner"
            />
          ) : expiring ? (
            <Banner
              tone="warning"
              title={
                expiring.days === 0
                  ? t("onboarding.documents.expiringToday", {
                      document: t(
                        `onboarding.documentTypes.${expiring.slot.type}`,
                      ),
                    })
                  : t(
                      `onboarding.documents.expiringIn.${pluralCategory(expiring.days, language)}`,
                      {
                        document: t(
                          `onboarding.documentTypes.${expiring.slot.type}`,
                        ),
                        days: expiring.days,
                      },
                    )
              }
              message={t("onboarding.documents.expiringBody")}
              testID="documents-expiring-banner"
            />
          ) : null}
          <View>
            {ordered.map((slot, index) => (
              <SlotRow
                key={slot.type}
                slot={slot}
                focused={slot.type === documentType}
                last={index === ordered.length - 1}
              />
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  renewal: { gap: spacing.xs },
  focused: {
    backgroundColor: colors.accentTint,
    borderRadius: radius.md,
    marginHorizontal: -spacing.ms,
    paddingHorizontal: spacing.ms,
  },
});
