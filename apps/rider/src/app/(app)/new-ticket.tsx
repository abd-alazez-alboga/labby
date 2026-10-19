import { useLocalSearchParams } from "expo-router";
import React from "react";

import TicketCreateScreen from "../../screens/support/ticket-create-screen";

export default function NewTicketRoute() {
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  return <TicketCreateScreen initialRideId={rideId ?? null} />;
}
