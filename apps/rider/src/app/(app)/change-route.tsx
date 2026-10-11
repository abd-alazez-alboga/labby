import { useLocalSearchParams } from "expo-router";
import React from "react";

import ChangeRouteScreen from "../../screens/ride/change-route-screen";

export default function ChangeRouteRoute() {
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  return <ChangeRouteScreen focus={focus === "stop" ? "stop" : "destination"} />;
}
