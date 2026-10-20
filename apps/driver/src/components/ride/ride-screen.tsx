import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { DriverCancelReason, Ride } from "../../api/ride-types";
import type { Route } from "../../api/routing";
import { useOptionalAvailability } from "../../realtime/AvailabilityProvider";
import type { DriverRideContextValue } from "../../rides/DriverRideProvider";
import {
  distanceMeters,
  formatDistance,
  formatMinutes,
  formatNumber,
  placeLabel,
} from "../../rides/format";
import { useRideRoute } from "../../rides/use-ride-route";
import { radius, spacing } from "../../theme/tokens";
import { BottomSheet, MapScreen, useDirection } from "../ui";
import { OsmMap } from "../map/osm-map";
import type { MapMarker } from "../map/osm-map";
import { CancelSheet } from "./cancel-sheet";
import { CompleteScreen } from "./complete-screen";
import { OfferCard } from "./offer-card";
import { InstructionCard, OnlinePill, RideNoticeBanner } from "./ride-parts";
import {
  NoShowConfirmSheet,
  SharedCollectScreen,
  SharedPickupSheet,
} from "./shared-parts";
import { SosConfirmSheet, SosPill } from "./safety-actions";
import {
  AtPickupSheet,
  InRideSheet,
  ToPickupSheet,
  toPickupInstruction,
} from "./ride-sheets";

/** Instruction card height (+ gap) kept clear of in-map banners. */
const TOP_CARD = 96;

/**
 * I60 (board DriverInRide): a stop counts as reached once the driver came
 * this close. The ride contract has no reached-stop state, so the app tracks
 * it locally — a display hint only; the server prices the whole route.
 */
export const STOP_REACHED_METERS = 150;

/**
 * The map layer of the ride screens: own position (follow-me), the pickup
 * or the stops + destination, and the OSRM route when it could be fetched.
 */
function RideMap({
  ride,
  offerPickup,
  route,
  bottom,
}: {
  ride: Ride | null;
  offerPickup: { lat: number; lng: number } | null;
  route: Route | null;
  bottom: number;
}) {
  const availability = useOptionalAvailability();
  const insets = useSafeAreaInsets();
  const position = availability?.position
    ? { lat: availability.position.lat, lng: availability.position.lng }
    : null;

  const markers: MapMarker[] = [];
  if (position) markers.push({ id: "self", kind: "self", position });
  if (offerPickup) markers.push({ id: "pickup", position: offerPickup });
  if (ride && (ride.state === "accepted" || ride.state === "driver_arrived"))
    markers.push({ id: "pickup", position: ride.pickup });
  if (ride && ride.state === "in_progress") {
    ride.stops.forEach((stop, index) =>
      markers.push({ id: `stop-${index}`, position: stop }),
    );
    markers.push({ id: "destination", position: ride.destination });
  }
  const center = position ?? offerPickup ?? ride?.pickup ?? null;
  if (!center) return null;

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { bottom: Math.max(0, bottom - radius.sheet) },
      ]}
    >
      <OsmMap
        center={center}
        markers={markers}
        route={route?.geometry ?? null}
        followMe={!!position}
        fill
        overlayTop={insets.top + TOP_CARD + spacing.sm}
        testID="ride-map"
      />
    </View>
  );
}

/**
 * The driver's ride flow on the home route (map-first, design canvas):
 * offer → to pickup → at pickup → in ride → complete, plus the cancel
 * sheet. Renders from the ride facade only.
 */
export function RideScreen({ ctx }: { ctx: DriverRideContextValue }) {
  const { t } = useTranslation();
  const { language } = useDirection();
  const insets = useSafeAreaInsets();
  const availability = useOptionalAvailability();
  const { height: windowHeight } = useWindowDimensions();
  const [sheetHeight, setSheetHeight] = useState(0);
  const [cancel, setCancel] = useState<{
    reason: DriverCancelReason | null;
  } | null>(null);
  const [sosOpen, setSosOpen] = useState(false);
  // M12 (UC-D-13 E1): the member the "Mark absent" sheet is open for.
  const [absentMember, setAbsentMember] = useState<string | null>(null);
  const ride = ctx.ride;
  const rideId = ride?.id ?? null;
  const rideState = ride?.state ?? null;

  // The sheet belongs to one ride phase: close it when the phase moves on.
  useEffect(() => {
    setCancel(null);
    setAbsentMember(null);
  }, [rideId, rideState]);

  // The SOS sheet belongs to one ride (phase changes keep it up).
  useEffect(() => {
    setSosOpen(false);
  }, [rideId]);

  const position = availability?.position ?? null;
  const route = useRideRoute(ride, position);

  // I60: how many stops of the running ride the driver has already passed.
  const [stopsPassed, setStopsPassed] = useState<{ rideId: string; count: number } | null>(null);
  const passed = stopsPassed && stopsPassed.rideId === rideId ? stopsPassed.count : 0;
  const nextStop =
    ride?.state === "in_progress" && passed < ride.stops.length
      ? ride.stops[passed]
      : null;
  const nextStopDistance =
    nextStop && position ? distanceMeters(position, nextStop) : null;
  useEffect(() => {
    if (rideId && nextStopDistance !== null && nextStopDistance <= STOP_REACHED_METERS) {
      setStopsPassed({ rideId, count: passed + 1 });
    }
  }, [rideId, nextStopDistance, passed]);

  // ------------------------------------------------------------- offer
  if (ctx.offer) {
    return (
      <MapScreen
        testID="ride-offer-screen"
        map={
          <RideMap
            ride={null}
            offerPickup={ctx.offer.offer.pickup}
            route={null}
            bottom={0}
          />
        }
        top={
          <View style={styles.topCard}>
            <OnlinePill />
          </View>
        }
        bottom={
          <View style={{ paddingBottom: Math.max(30, insets.bottom + 12) }}>
            <OfferCard ctx={ctx} />
          </View>
        }
      />
    );
  }
  if (!ride) return null;

  // ---------------------------------------------------------- complete
  if (ride.state === "completed") {
    // M12 (UC-D-13 step 3): a shared ride is collected per member.
    if (ride.kind === "shared")
      return <SharedCollectScreen ctx={ctx} ride={ride} />;
    return <CompleteScreen ctx={ctx} ride={ride} />;
  }

  // ------------------------------------------------------- map phases
  let top: React.ReactNode = null;
  let sheet: React.ReactNode = null;
  if (ride.state === "accepted") {
    const distance = position
      ? distanceMeters(position, ride.pickup)
      : null;
    const instruction = toPickupInstruction(
      t,
      ride,
      language,
      distance,
      route?.durationSeconds ?? null,
    );
    top = (
      <InstructionCard
        icon="location-outline"
        title={instruction.title}
        subtitle={instruction.subtitle}
        testID="to-pickup-instruction"
      />
    );
    sheet = (
      <ToPickupSheet
        ctx={ctx}
        ride={ride}
        onCancel={() => setCancel({ reason: null })}
      />
    );
  } else if (ride.state === "driver_arrived" && ride.kind === "shared") {
    sheet = (
      <SharedPickupSheet
        ctx={ctx}
        ride={ride}
        onCancel={() => setCancel({ reason: null })}
        onMarkAbsent={setAbsentMember}
      />
    );
  } else if (ride.state === "driver_arrived") {
    sheet = (
      <AtPickupSheet
        ctx={ctx}
        ride={ride}
        onCancel={() => setCancel({ reason: null })}
        onNoShow={() => setCancel({ reason: "rider_no_show" })}
      />
    );
  } else if (ride.state === "in_progress" && nextStop) {
    // I60: while stops remain, the top card leads to the next one.
    top = (
      <InstructionCard
        badge={formatNumber(passed + 1, language)}
        subtitleFirst
        subtitle={
          nextStopDistance !== null
            ? t("ride.inRide.nextStopIn", {
                distance: formatDistance(t, nextStopDistance, language),
              })
            : t("ride.inRide.nextStop")
        }
        title={placeLabel(t, nextStop)}
        testID="in-ride-instruction"
      />
    );
    sheet = <InRideSheet ctx={ctx} ride={ride} />;
  } else if (ride.state === "in_progress") {
    const eta = ride.etaSeconds ?? route?.durationSeconds ?? null;
    top = (
      <InstructionCard
        icon="flag-outline"
        subtitleFirst
        subtitle={
          eta !== null
            ? t("ride.inRide.dropOffIn", {
                eta: formatMinutes(t, eta, language),
              })
            : t("ride.dropOff")
        }
        title={placeLabel(t, ride.destination)}
        testID="in-ride-instruction"
      />
    );
    sheet = <InRideSheet ctx={ctx} ride={ride} />;
  }

  return (
    <View style={styles.fill} testID="ride-screen">
      <MapScreen
        map={<RideMap
            ride={ride}
            offerPickup={null}
            route={route}
            bottom={sheetHeight}
          />}
        top={
          <View style={styles.topCard}>
            {top}
            {/* M12 (UC-D-12): the claimed scheduled ride just went live. */}
            {ctx.notice === "scheduledLive" ? (
              <RideNoticeBanner
                notice={ctx.notice}
                detail={{ scheduledAt: ride.scheduled?.scheduledAt ?? null }}
                onDismiss={ctx.dismissNotice}
              />
            ) : null}
            {/* M10 (UC-S-16): the floating red SOS pill on every phase. */}
            <SosPill onPress={() => setSosOpen(true)} />
          </View>
        }
        bottom={
          <View
            onLayout={(event) =>
              setSheetHeight(event.nativeEvent.layout.height)
            }
          >
            <BottomSheet
              maxHeight={Math.round(windowHeight * 0.66)}
              testID="ride-sheet"
            >
              {sheet}
            </BottomSheet>
          </View>
        }
      />
      {absentMember && ride.state === "driver_arrived" ? (
        <NoShowConfirmSheet
          ctx={ctx}
          ride={ride}
          memberId={absentMember}
          onClose={() => {
            ctx.clearError();
            setAbsentMember(null);
          }}
        />
      ) : null}
      {sosOpen ? (
        <SosConfirmSheet ride={ride} onClose={() => setSosOpen(false)} />
      ) : null}
      {cancel && (ride.state === "accepted" || ride.state === "driver_arrived") ? (
        <KeyboardAvoidingView
          style={StyleSheet.absoluteFill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <CancelSheet
            ctx={ctx}
            ride={ride}
            initialReason={cancel.reason}
            onClose={() => {
              ctx.clearError();
              setCancel(null);
            }}
          />
        </KeyboardAvoidingView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topCard: { flex: 1, gap: spacing.sm },
});
