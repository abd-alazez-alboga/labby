/**
 * The /rate/{rideId} route (UC-S-17): the rating screen for a ride opened
 * from history ("Rate Samer · N days left") or by the cold-start prompt.
 * It reads the ride (`GET /rides/{id}`) for the driver, the ride line and
 * `myRating`; a ride that can no longer be rated opens as the closable
 * notice with the matching copy.
 */
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";

import { failureKind, type FailureKind } from "../../api/http-client";
import { getRide, type Ride } from "../../api/rides";
import { ErrorView, LoadingView } from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { markRatingPrompted } from "../../trust/rating-prompts";
import { type RatingBlock, ratingRideLine, RatingView } from "./rating-view";

/** The notice a ride's own rating state calls for (null = can be rated). */
export function ratingBlockOf(ride: Ride): RatingBlock | null {
  switch (ride.myRating?.state) {
    case "pending":
      return null;
    case "submitted":
      return "rating_already_submitted";
    case "expired":
      return "rating_window_closed";
    case "not_applicable":
      return "ride_not_completed";
    default:
      return ride.state === "completed" ? null : "ride_not_completed";
  }
}

export default function RateScreen({ rideId }: { rideId: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [ride, setRide] = useState<Ride | null>(null);
  const [failure, setFailure] = useState<FailureKind | null>(null);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      setRide(await getRide(rideId));
    } catch (error) {
      setFailure(failureKind(error));
    }
  }, [rideId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const leave = () => {
    void markRatingPrompted(rideId);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  if (failure) return <ErrorView kind={failure} onRetry={() => void load()} />;
  if (!ride) return <LoadingView testID="rate-loading" />;

  return (
    <RatingView
      rideId={ride.id}
      driverName={ride.driver?.firstName ?? ""}
      driverPhotoUrl={ride.driver?.photoUrl}
      rideLine={ratingRideLine(ride, locale, t)}
      windowEndsAt={ride.myRating?.windowEndsAt}
      initialBlock={ratingBlockOf(ride)}
      onDone={leave}
    />
  );
}
