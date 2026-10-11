/**
 * In-ride route change (UC-R-06, RIDE-05) — the RiderInRide artboard's
 * "Change destination" / "Add stop" open the RiderWhereTo layout with the
 * pickup fixed. `PUT /rides/{id}/route` re-estimates server-side; ≤ 3 stops
 * (422 `too_many_stops`, UC-R-06 E1) and region bounds are the server's
 * call and are explained by code.
 */
import { useRouter } from "expo-router";
import React from "react";

import { ROUTE_CHANGE_STATES } from "../../api/rides";
import { EmptyView, LoadingView } from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { useActiveRide } from "../../ride/ride-context";
import { RoutePlanner } from "./route-planner";

export default function ChangeRouteScreen({
  focus = "destination",
}: {
  focus?: "destination" | "stop";
}) {
  const { t } = useLocale();
  const router = useRouter();
  const { ride, loading, changeRoute } = useActiveRide();

  if (!ride && loading) return <LoadingView testID="change-route-loading" />;
  if (!ride || !ROUTE_CHANGE_STATES.includes(ride.state)) {
    return (
      <EmptyView
        icon="car-outline"
        title={t("booking.errors.illegal_state")}
        testID="change-route-unavailable"
      />
    );
  }

  return (
    <RoutePlanner
      key={ride.id}
      mode="route"
      testID="change-route"
      initialPickup={ride.pickup}
      initialStops={ride.stops}
      initialDestination={ride.destination}
      initialFocus={focus}
      submitLabel={t("booking.updateRoute")}
      onSubmit={async (route) => {
        await changeRoute({
          destination: route.destination,
          stops: route.stops,
        });
        router.back();
      }}
      onBack={() => router.back()}
    />
  );
}
