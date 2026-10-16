import { useLocalSearchParams } from "expo-router";
import React from "react";

import { ReportRiderScreen } from "../components/trust/report-rider-screen";

export default function ReportRiderRoute() {
  const { rideId, name, when, place } = useLocalSearchParams<{
    rideId?: string;
    name?: string;
    when?: string;
    place?: string;
  }>();
  if (!rideId) return null;
  return (
    <ReportRiderScreen
      rideId={rideId}
      name={name ?? ""}
      when={when ?? null}
      place={place ?? null}
    />
  );
}
