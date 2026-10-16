import { useLocalSearchParams } from "expo-router";
import React from "react";

import ReportScreen from "../../../screens/trust/report-screen";

export default function ReportRoute() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  return <ReportScreen rideId={String(rideId)} />;
}
