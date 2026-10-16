/**
 * The ride opened from a push tap (deep link `ride` {rideId}, rides-v1.yaml
 * "Push"): the facade tracks that ride and this screen renders it with the
 * same views as home. Done / Close returns to wherever the rider came from.
 * M12: a ride that is still pre-live opens its own screen instead — the
 * scheduled ride (`scheduled`) or the shared ride gathering members.
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
    let cancelled = false;
    void track(rideId).then((read) => {
      if (cancelled || !read) return;
      if (read.state === "scheduled") {
        router.replace(`/scheduled/${encodeURIComponent(read.id)}` as never);
      } else if (read.state === "gathering") {
        router.replace(`/shared/${encodeURIComponent(read.id)}` as never);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router is stable
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
