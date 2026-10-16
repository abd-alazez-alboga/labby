import { useLocalSearchParams } from "expo-router";
import React from "react";

import { ReportsScreen } from "../components/trust/reports-screen";

export default function ReportsRoute() {
  const { sent } = useLocalSearchParams<{ sent?: string }>();
  return <ReportsScreen justSent={sent === "1"} />;
}
