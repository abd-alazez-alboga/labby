import { useLocalSearchParams } from "expo-router";
import React from "react";

import { LostItemCaseScreen } from "../components/support/lost-item-case-screen";

export default function LostItemCaseRoute() {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  return <LostItemCaseScreen ticketId={ticketId ?? ""} />;
}
