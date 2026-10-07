import { useRouter } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { Image, RefreshControl, StyleSheet, View } from "react-native";

import { getMyVehicles, resolveFileUrl } from "../../api/onboarding";
import type { Vehicle, VehicleWithDocuments } from "../../api/onboarding-types";
import { useLocale } from "../../i18n/LocaleProvider";
import { useRemote } from "../../onboarding/use-remote";
import { colors, radius } from "../../theme/tokens";
import {
  Banner,
  BodyText,
  FailureState,
  KeyValue,
  ListRow,
  LoadingState,
  Muted,
  PrimaryButton,
  Screen,
  SectionLabel,
  StatusChip,
} from "../ui";
import type { Tone } from "../ui";

function VehicleRow({
  vehicle,
  chip,
  last,
  testID,
  children,
}: {
  vehicle: Vehicle;
  chip: { label: string; tone: Tone };
  last?: boolean;
  testID: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const cover = vehicle.photos[0];
  return (
    <ListRow
      title={`${vehicle.make} ${vehicle.model} · ${vehicle.year}`}
      leading={
        cover ? (
          <Image
            source={{ uri: resolveFileUrl(cover.url) }}
            style={styles.cover}
          />
        ) : undefined
      }
      icon={cover ? undefined : "car-outline"}
      trailing={<StatusChip label={chip.label} tone={chip.tone} />}
      last={last}
      testID={testID}
    >
      <KeyValue label={t("onboarding.vehicle.plate")} value={vehicle.plate} />
      <KeyValue label={t("onboarding.vehicle.color")} value={vehicle.color} />
      <KeyValue
        label={t("onboarding.vehicle.seats")}
        value={String(vehicle.seats)}
      />
      {children}
    </ListRow>
  );
}

/**
 * UC-D-18 — the active vehicle, a switch under review, and rejected
 * switches with their reasons; the entry to submitting a new vehicle.
 */
export function VehiclesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { language } = useLocale();
  const { state, refreshing, reload } = useRemote(getMyVehicles);

  const vehicles: VehicleWithDocuments[] =
    state.status === "loaded" ? state.data : [];
  const active = vehicles.find((vehicle) => vehicle.active) ?? null;
  const pending = vehicles.find(
    (vehicle) => !vehicle.active && vehicle.reviewStatus === "pending",
  );
  const rejected = vehicles.filter(
    (vehicle) => vehicle.reviewStatus === "rejected",
  );

  return (
    <Screen
      title={t("onboarding.vehicles.title")}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void reload()}
        />
      }
      footer={
        state.status === "loaded" ? (
          <>
            {pending ? (
              <Muted testID="vehicle-switch-blocked">
                {t("onboarding.vehicles.switchBlocked")}
              </Muted>
            ) : null}
            <PrimaryButton
              title={t("onboarding.vehicles.switch")}
              onPress={() => router.push("/vehicle-switch")}
              disabled={!!pending}
              testID="vehicle-switch-start"
            />
          </>
        ) : undefined
      }
      testID="vehicles-screen"
    >
      {state.status === "loading" ? <LoadingState /> : null}
      {state.status === "error" ? (
        <FailureState kind={state.kind} onRetry={() => void reload()} />
      ) : null}
      {state.status === "loaded" ? (
        <>
          {active ? (
            <VehicleRow
              vehicle={active}
              chip={{ label: t("onboarding.vehicles.active"), tone: "success" }}
              last={!pending}
              testID="vehicle-active"
            >
              {active.serviceTypes.length > 0 ? (
                <Muted testID="vehicle-active-service-types">
                  {t("onboarding.vehicles.serviceTypes", {
                    types: active.serviceTypes
                      .map((type) =>
                        language === "ar" ? type.nameAr : type.nameEn,
                      )
                      .join(language === "ar" ? "، " : ", "),
                  })}
                </Muted>
              ) : null}
            </VehicleRow>
          ) : (
            <BodyText testID="vehicle-none">
              {t("onboarding.vehicles.none")}
            </BodyText>
          )}

          {pending ? (
            <VehicleRow
              vehicle={pending}
              chip={{
                label: t("onboarding.vehicles.pending"),
                tone: "warning",
              }}
              last
              testID="vehicle-pending"
            >
              <Muted>{t("onboarding.vehicles.pendingHint")}</Muted>
            </VehicleRow>
          ) : null}

          {rejected.length > 0 ? (
            <View>
              <SectionLabel>
                {t("onboarding.vehicles.rejectedTitle")}
              </SectionLabel>
              {rejected.map((vehicle, index) => (
                <VehicleRow
                  key={vehicle.id}
                  vehicle={vehicle}
                  chip={{
                    label: t("onboarding.vehicles.rejected"),
                    tone: "danger",
                  }}
                  last={index === rejected.length - 1}
                  testID={`vehicle-rejected-${vehicle.id}`}
                >
                  <Banner
                    tone="danger"
                    title={t("onboarding.vehicles.reason")}
                    message={
                      vehicle.reviewNote ?? t("onboarding.documents.noReason")
                    }
                  />
                </VehicleRow>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cover: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMap,
  },
});
