import { useLocalSearchParams } from "expo-router";
import React from "react";

import RateScreen from "../../../screens/trust/rate-screen";

export default function RateRoute() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  return <RateScreen rideId={String(rideId)} />;
}
