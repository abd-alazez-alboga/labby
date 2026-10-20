import { useLocalSearchParams } from "expo-router";
import React from "react";

import TicketCreateScreen from "../../screens/support/ticket-create-screen";

export default function NewTicketRoute() {
  const { rideId, about, reason } = useLocalSearchParams<{
    rideId?: string;
    about?: string;
    reason?: string;
  }>();
  return (
    <TicketCreateScreen
      initialRideId={rideId ?? null}
      aboutSuspension={
        about === "suspension" ? { reason: reason ?? null } : null
      }
    />
  );
}
