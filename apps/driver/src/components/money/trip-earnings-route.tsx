import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Ride } from "../../api/ride-types";
import { getDriverRide } from "../../api/rides";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { FailureState, LoadingState, Screen } from "../ui";
import { TripEarningsScreen } from "./trip-earnings-screen";

type Load =
  | { status: "loading" }
  | { status: "loaded"; ride: Ride }
  | { status: "error"; kind: FailureKind };

/**
 * I59 (board DriverEarnings): a trip row of the earnings list opens its
 * "Trip earnings" breakdown — the ride is read, then the same screen as
 * after a settled payment; Done goes back to the list.
 */
export function TripEarningsRoute() {
  const { t } = useTranslation();
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const [load, setLoad] = useState<Load>({ status: "loading" });

  const fetchRide = useCallback(async () => {
    if (!rideId) {
      setLoad({ status: "error", kind: "server" });
      return;
    }
    setLoad({ status: "loading" });
    try {
      setLoad({ status: "loaded", ride: await getDriverRide(rideId) });
    } catch (caught) {
      setLoad({ status: "error", kind: failureKindOf(caught) });
    }
  }, [rideId]);

  useEffect(() => {
    void fetchRide();
  }, [fetchRide]);

  if (load.status === "loaded") {
    return (
      <TripEarningsScreen
        ride={load.ride}
        onDone={() => router.back()}
        fromEarnings
      />
    );
  }
  return (
    <Screen title={t("tripEarnings.title")} testID="trip-earnings-route">
      {load.status === "loading" ? <LoadingState /> : null}
      {load.status === "error" ? (
        <FailureState kind={load.kind} onRetry={() => void fetchRide()} />
      ) : null}
    </Screen>
  );
}
