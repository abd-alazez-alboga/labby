import { useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";

import type { PlannedRoute } from "../../screens/ride/route-planner";
import BookingScreen from "../../screens/ride/booking-screen";

/** M12 "Book now instead": the scheduled flow's route, as JSON. */
function parseRoute(value: string | undefined): PlannedRoute | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as PlannedRoute;
    return parsed?.pickup && parsed?.destination
      ? { ...parsed, stops: Array.isArray(parsed.stops) ? parsed.stops : [] }
      : null;
  } catch {
    return null;
  }
}

export default function BookingRoute() {
  const { edit, destinationId, route } = useLocalSearchParams<{
    edit?: string;
    destinationId?: string;
    route?: string;
  }>();
  const presetRoute = useMemo(() => parseRoute(route), [route]);
  return (
    <BookingScreen
      edit={edit === "1"}
      destinationId={destinationId ?? null}
      presetRoute={presetRoute}
    />
  );
}
