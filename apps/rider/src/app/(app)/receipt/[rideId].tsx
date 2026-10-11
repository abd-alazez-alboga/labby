import { useLocalSearchParams } from "expo-router";
import React from "react";

import ReceiptScreen from "../../../screens/ride/receipt-screen";

export default function ReceiptRoute() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  return <ReceiptScreen rideId={String(rideId)} />;
}
