/**
 * The ride opened from a push tap (deep link `ride` {rideId}, rides-v1.yaml
 * "Push"): the facade tracks that ride and this screen renders it with the
 * same views as home. Done / Close returns to wherever the rider came from.
 */
import { useRouter } from "expo-router";
import React, { useEffect } from "react";

import { LoadingView } from "../../components/ui";
import { useActiveRide } from "../../ride/ride-context";
import { RideView } from "./ride-view";

export default function RideScreen({ rideId }: { rideId: string }) {
  const router = useRouter();
  const { ride, track } = useActiveRide();

  useEffect(() => {
    void track(rideId);
  }, [rideId, track]);

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  // The tracked ride may have been re-dispatched/retried into a new id —
  // the facade follows it, so whatever ride it holds is the one to show.
  if (!ride) return <LoadingView testID="ride-screen-loading" />;
  return <RideView ride={ride} onDone={leave} />;
}
