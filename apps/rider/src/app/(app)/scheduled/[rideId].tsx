import { useLocalSearchParams } from "expo-router";
import React from "react";

import ScheduledRideScreen from "../../../screens/scheduled/scheduled-ride-screen";

export default function ScheduledRideRoute() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  return <ScheduledRideScreen rideId={String(rideId)} />;
}
