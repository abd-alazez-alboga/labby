import { useLocalSearchParams } from "expo-router";
import React from "react";

import SharedRideScreen from "../../../screens/shared/shared-ride-screen";

export default function SharedRideRoute() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  return <SharedRideScreen rideId={String(rideId)} />;
}
