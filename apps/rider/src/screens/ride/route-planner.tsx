/**
 * Route planning (approved artboards RiderWhereTo / RiderWhereToAr): pickup,
 * up to 3 stops and the destination, each set from a saved place (one tap),
 * a pin on the map, or — for the pickup — the current location. Typing in a
 * field searches the rider's saved places (the contract has no geocoding
 * endpoint). Used for booking (`mode="book"`) and for in-ride route changes
 * (`mode="route"`: the pickup is fixed, RIDE-05). M12: shared rides plan
 * one pickup and one destination (`allowStops={false}`, own `title`).
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MAX_STOPS, type Place, type SavedLocation } from "../../api/rides";
import {
  AppText,
  Banner,
  BottomSheet,
  ListRow,
  MapFab,
  MapScreen,
  PrimaryButton,
  useDirection,
  useFontFamily,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { useCurrentPosition } from "../../location/use-current-position";
import type { LatLng } from "../../map/geo";
import { placeLabel } from "../../ride/ride-format";
import { rideErrorMessage } from "../../ride/ride-errors";
import { useSavedPlaces } from "../../ride/use-saved-places";
import { colors, radius, spacing, typography } from "../../theme/tokens";
import { PinPicker } from "./pin-picker";
import { RideMap } from "./ride-parts";

export interface PlannedRoute {
  pickup: Place;
  stops: Place[];
  destination: Place;
}

type FieldKey = "pickup" | "destination" | `stop-${number}`;

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** Icon for a saved place by its (case-insensitive) name. */
export function savedPlaceIcon(name: string): IconName {
  const key = name.trim().toLowerCase();
  if (key === "home" || key === "المنزل") return "home-outline";
  if (key === "work" || key === "العمل") return "briefcase-outline";
  return "location-outline";
}

export function savedToPlace(saved: SavedLocation): Place {
  return { lat: saved.lat, lng: saved.lng, label: saved.name };
}

function stopIndex(key: FieldKey): number | null {
  return key.startsWith("stop-") ? Number(key.slice(5)) : null;
}

export function RoutePlanner({
  mode,
  initialPickup = null,
  initialStops = [],
  initialDestination = null,
  initialFocus = "destination",
  submitLabel,
  onSubmit,
  onBack,
  footer,
  title,
  allowStops = true,
  testID = "route-planner",
}: {
  mode: "book" | "route";
  initialPickup?: Place | null;
  initialStops?: Place[];
  initialDestination?: Place | null;
  initialFocus?: "destination" | "stop";
  submitLabel: string;
  /** Throws on failure; the planner explains the error by its code. */
  onSubmit: (route: PlannedRoute) => Promise<void>;
  onBack: () => void;
  /** Extra rows above the primary action (the matching-toggle line). */
  footer?: React.ReactNode;
  /** Overrides the sheet title. */
  title?: string;
  /** False: no stops (M12 shared rides — one pickup, one destination). */
  allowStops?: boolean;
  testID?: string;
}) {
  const { t, isRTL, flipRows } = useLocale();
  const { row, backChevron } = useDirection();
  const { top } = useSafeAreaInsets();
  const inputFont = useFontFamily(700);
  const saved = useSavedPlaces();
  const current = useCurrentPosition();

  const [chosenPickup, setPickup] = useState<Place | null>(initialPickup);
  const [stops, setStops] = useState<(Place | null)[]>(() => {
    const list: (Place | null)[] = [...initialStops];
    if (initialFocus === "stop" && list.length < MAX_STOPS) list.push(null);
    return list;
  });
  const [destination, setDestination] = useState<Place | null>(
    initialDestination,
  );
  const [active, setActive] = useState<FieldKey>(
    initialFocus === "stop" && initialStops.length < MAX_STOPS
      ? `stop-${initialStops.length}`
      : "destination",
  );
  const [query, setQuery] = useState("");
  const [pinTarget, setPinTarget] = useState<FieldKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Booking starts from where the rider is (UC-R-04 step 1).
  const pickup: Place | null =
    chosenPickup ??
    (mode === "book" && current.position
      ? { ...current.position, label: t("booking.currentLocation") }
      : null);

  const valueOf = (key: FieldKey): Place | null => {
    if (key === "pickup") return pickup;
    if (key === "destination") return destination;
    return stops[stopIndex(key) ?? 0] ?? null;
  };

  const assign = (key: FieldKey, place: Place) => {
    setError(null);
    setQuery("");
    if (key === "pickup") setPickup(place);
    else if (key === "destination") setDestination(place);
    else {
      const index = stopIndex(key) ?? 0;
      setStops((list) => list.map((item, i) => (i === index ? place : item)));
    }
  };

  const addStop = () => {
    if (stops.length >= MAX_STOPS) return;
    setStops((list) => [...list, null]);
    setActive(`stop-${stops.length}`);
    setQuery("");
  };

  const removeStop = (index: number) => {
    setStops((list) => list.filter((_, i) => i !== index));
    setActive("destination");
    setQuery("");
  };

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return saved.places.filter(
      (place) =>
        place.name.toLowerCase().includes(needle) ||
        (place.address ?? "").toLowerCase().includes(needle),
    );
  }, [query, saved.places]);

  /** A point to open the pin picker on (no invented default location). */
  const reference: LatLng | null =
    valueOf(active) ??
    current.position ??
    pickup ??
    destination ??
    (saved.places[0]
      ? { lat: saved.places[0].lat, lng: saved.places[0].lng }
      : null);

  const submit = async () => {
    const chosenStops = stops.filter((stop): stop is Place => !!stop);
    if (!pickup) {
      setError(t("booking.missingPickup"));
      return;
    }
    if (!destination) {
      setError(t("booking.missingDestination"));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit({ pickup, stops: chosenStops, destination });
    } catch (failure) {
      setError(rideErrorMessage(failure, t));
    } finally {
      setBusy(false);
    }
  };

  if (pinTarget && reference) {
    return (
      <PinPicker
        initial={valueOf(pinTarget) ?? reference}
        onBack={() => setPinTarget(null)}
        onConfirm={(point) => {
          assign(pinTarget, { ...point, label: t("booking.pinnedPlace") });
          setPinTarget(null);
        }}
      />
    );
  }

  const inputAlign = isRTL
    ? flipRows
      ? styles.alignRight
      : styles.alignLeft
    : null;

  const renderField = (key: FieldKey, label: string, removable?: number) => {
    const place = valueOf(key);
    const isActive = key === active;
    const locked = mode === "route" && key === "pickup";
    return (
      <View
        key={key}
        style={[
          styles.field,
          { flexDirection: row },
          isActive && !locked ? styles.fieldActive : null,
        ]}
        testID={`${testID}-field-${key}`}
      >
        <View style={styles.fieldText}>
          <AppText variant="caption" weight={700} tone="muted">
            {label}
          </AppText>
          {locked ? (
            <AppText variant="bodyStrong">{placeLabel(place)}</AppText>
          ) : (
            <TextInput
              value={isActive && query ? query : place ? placeLabel(place) : ""}
              placeholder={
                key === "pickup" && current.status === "locating"
                  ? t("booking.locating")
                  : t("booking.choosePlace")
              }
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.accent}
              onFocus={() => {
                setActive(key);
                setQuery("");
              }}
              onChangeText={(text) => {
                setActive(key);
                setQuery(text);
              }}
              accessibilityLabel={label}
              style={[
                styles.input,
                { fontFamily: inputFont },
                isRTL && styles.inputRtl,
                inputAlign,
              ]}
              testID={`${testID}-input-${key}`}
            />
          )}
        </View>
        {removable !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("booking.removeStop")}
            onPress={() => removeStop(removable)}
            style={styles.remove}
            testID={`${testID}-remove-stop-${removable}`}
          >
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  const mapCenter = pickup ?? current.position ?? destination;
  const placedStops = stops.filter((stop): stop is Place => !!stop);

  return (
    <MapScreen
      testID={testID}
      map={
        mapCenter ? (
          <RideMap
            pickup={pickup ?? mapCenter}
            stops={placedStops}
            destination={destination ?? pickup ?? mapCenter}
            noticeTop={top + 72}
            testID={`${testID}-map`}
          />
        ) : (
          <View style={styles.mapPlaceholder} />
        )
      }
      floating={
        <MapFab
          icon={backChevron}
          accessibilityLabel={t("common.back")}
          onPress={onBack}
          testID={`${testID}-back`}
        />
      }
      sheet={
        <BottomSheet style={styles.sheet}>
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <AppText variant="heading">
              {title ??
                (mode === "book"
                  ? t("booking.planTitle")
                  : t("booking.routeTitle"))}
            </AppText>

            <View style={styles.fields}>
              {renderField("pickup", t("booking.pickup"))}
              {stops.map((_, index) =>
                renderField(
                  `stop-${index}`,
                  t("booking.stop", { number: index + 1 }),
                  index,
                ),
              )}
              {renderField("destination", t("booking.destination"))}
            </View>

            {allowStops && stops.length < MAX_STOPS ? (
              <Pressable
                accessibilityRole="button"
                onPress={addStop}
                style={({ pressed }) => [
                  styles.addStop,
                  { flexDirection: row },
                  flipRows ? styles.selfEnd : styles.selfStart,
                  pressed && styles.pressed,
                ]}
                testID={`${testID}-add-stop`}
              >
                <Ionicons name="add" size={18} color={colors.text} />
                <AppText variant="label" weight={700}>
                  {t("booking.addStop")}
                </AppText>
                <AppText variant="label" tone="muted">
                  {t("booking.stopsLeft", { count: MAX_STOPS - stops.length })}
                </AppText>
              </Pressable>
            ) : null}

            {saved.places.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.chips, { flexDirection: row }]}
                keyboardShouldPersistTaps="handled"
              >
                {saved.places.map((place) => (
                  <Pressable
                    key={place.id}
                    accessibilityRole="button"
                    onPress={() => assign(active, savedToPlace(place))}
                    style={({ pressed }) => [
                      styles.chip,
                      { flexDirection: row },
                      pressed && styles.pressed,
                    ]}
                    testID={`${testID}-saved-${place.id}`}
                  >
                    <Ionicons
                      name={savedPlaceIcon(place.name)}
                      size={16}
                      color={colors.text}
                    />
                    <AppText variant="label" weight={700}>
                      {place.name}
                    </AppText>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            <View>
              {query.trim()
                ? matches.length > 0
                  ? matches.map((place) => (
                      <ListRow
                        key={place.id}
                        icon={savedPlaceIcon(place.name)}
                        title={place.name}
                        subtitle={place.address ?? placeLabel(place)}
                        onPress={() => assign(active, savedToPlace(place))}
                        testID={`${testID}-match-${place.id}`}
                      />
                    ))
                  : (
                      <AppText
                        variant="secondary"
                        tone="muted"
                        testID={`${testID}-no-matches`}
                      >
                        {t("booking.noMatches")}
                      </AppText>
                    )
                : null}
              {active === "pickup" && mode === "book" && current.position ? (
                <ListRow
                  icon="navigate-outline"
                  title={t("booking.useCurrentLocation")}
                  onPress={() =>
                    current.position &&
                    assign("pickup", {
                      ...current.position,
                      label: t("booking.currentLocation"),
                    })
                  }
                  testID={`${testID}-use-current`}
                />
              ) : null}
              {reference ? (
                <ListRow
                  icon="location-outline"
                  title={t("booking.chooseOnMap")}
                  subtitle={t("booking.dropPin")}
                  last
                  onPress={() => setPinTarget(active)}
                  testID={`${testID}-choose-on-map`}
                />
              ) : null}
            </View>

            {error ? (
              <Banner tone="danger" message={error} testID={`${testID}-error`} />
            ) : null}
          </ScrollView>
          {footer}
          <PrimaryButton
            label={submitLabel}
            onPress={() => void submit()}
            loading={busy}
            testID={`${testID}-submit`}
          />
        </BottomSheet>
      }
    />
  );
}

const styles = StyleSheet.create({
  sheet: {
    maxHeight: "78%",
  },
  sheetContent: {
    gap: 14,
  },
  mapPlaceholder: {
    flex: 1,
    backgroundColor: colors.surfaceMap,
  },
  fields: {
    gap: spacing.sm,
  },
  field: {
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.chip,
    borderWidth: 2,
    borderColor: "transparent",
    paddingVertical: 6,
    paddingHorizontal: 12,
    minHeight: 56,
  },
  fieldActive: {
    backgroundColor: colors.surface,
    borderColor: colors.text,
  },
  fieldText: {
    flex: 1,
    gap: 2,
  },
  input: {
    padding: 0,
    fontSize: typography.bodyStrong.fontSize,
    color: colors.text,
    minHeight: 24,
  },
  inputRtl: {
    writingDirection: "rtl",
  },
  alignRight: {
    textAlign: "right",
  },
  alignLeft: {
    textAlign: "left",
  },
  remove: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  addStop: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: radius.round,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    alignItems: "center",
    gap: spacing.sm,
  },
  selfStart: {
    alignSelf: "flex-start",
  },
  selfEnd: {
    alignSelf: "flex-end",
  },
  chips: {
    gap: spacing.sm,
  },
  chip: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: radius.round,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
});
