import { useLocalSearchParams } from "expo-router";
import React from "react";

import { ReportRiderScreen } from "../components/trust/report-rider-screen";

export default function ReportRiderRoute() {
  const { rideId, memberId, name, when, place } = useLocalSearchParams<{
    rideId?: string;
    /** M12: the reported member of a shared ride. */
    memberId?: string;
    name?: string;
    when?: string;
    place?: string;
  }>();
  if (!rideId) return null;
  return (
    <ReportRiderScreen
      rideId={rideId}
      memberId={memberId ?? null}
      name={name ?? ""}
      when={when ?? null}
      place={place ?? null}
    />
  );
}
