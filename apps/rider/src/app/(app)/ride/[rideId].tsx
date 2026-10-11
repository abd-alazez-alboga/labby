import { useLocalSearchParams } from "expo-router";
import React from "react";

import RideScreen from "../../../screens/ride/ride-screen";

export default function RideRoute() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  return <RideScreen rideId={String(rideId)} />;
}
