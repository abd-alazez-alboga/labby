import { useLocalSearchParams } from "expo-router";
import React from "react";

import { TripDetailScreen } from "../components/money/trip-detail-screen";

export default function TripDetailRoute() {
  const { rideId, memberId } = useLocalSearchParams<{
    rideId?: string;
    /** The shared-ride member the trip row is about. */
    memberId?: string;
  }>();
  if (!rideId) return null;
  return <TripDetailScreen rideId={rideId} memberId={memberId ?? null} />;
}
