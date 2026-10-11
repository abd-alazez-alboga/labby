import { useLocalSearchParams } from "expo-router";
import React from "react";

import BookingScreen from "../../screens/ride/booking-screen";

export default function BookingRoute() {
  const { edit, destinationId } = useLocalSearchParams<{
    edit?: string;
    destinationId?: string;
  }>();
  return (
    <BookingScreen edit={edit === "1"} destinationId={destinationId ?? null} />
  );
}
