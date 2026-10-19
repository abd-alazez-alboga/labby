import { useLocalSearchParams } from "expo-router";
import React from "react";

import LostItemReportScreen from "../../../screens/support/lost-item-report-screen";

export default function LostItemReportRoute() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  return <LostItemReportScreen rideId={rideId} />;
}
