import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet, View } from "react-native";

import { getMyDocuments } from "../../api/onboarding";
import type { DocumentSlot } from "../../api/onboarding-types";
import { DOCUMENT_TYPES } from "../../api/onboarding-types";
import { useLocale } from "../../i18n/LocaleProvider";
import { formatDate } from "../../onboarding/dates";
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
  const validity = `${t(
    slot.expired
      ? "onboarding.documents.expiredOn"
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
          subtitle={`${current.number} · ${validity}`}
          subtitleColor={slot.expired ? colors.danger : undefined}
          trailing={
            slot.expired ? (
              <StatusChip
                label={t("onboarding.documents.expired")}
                tone="danger"
                testID={`slot-${slot.type}-expired`}
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
 * row opens its renewal; an expired document's renewal is pinned below.
 */
export function DocumentsScreen() {
  const { t } = useTranslation();
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
  const renewFirst = ordered.find(
    (slot) => slot.expired && slot.renewal?.reviewStatus !== "pending",
  );

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
          <BodyText>{t("onboarding.documents.intro")}</BodyText>
          {anyExpired ? (
            <Banner
              tone="danger"
              message={t("onboarding.documents.expiredBanner")}
              testID="documents-expired-banner"
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
