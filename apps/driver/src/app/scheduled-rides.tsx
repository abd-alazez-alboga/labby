import { useLocalSearchParams } from "expo-router";
import React from "react";

import { ScheduledRidesScreen } from "../components/scheduled/scheduled-rides-screen";

export default function ScheduledRidesRoute() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  return <ScheduledRidesScreen initialTab={tab === "mine" ? "mine" : "board"} />;
}
