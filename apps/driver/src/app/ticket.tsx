import { useLocalSearchParams } from "expo-router";
import React from "react";

import { TicketThreadScreen } from "../components/support/ticket-thread-screen";

export default function TicketRoute() {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  return <TicketThreadScreen ticketId={ticketId ?? ""} />;
}
