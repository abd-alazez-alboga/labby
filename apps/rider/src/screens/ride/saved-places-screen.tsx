/**
 * Saved places (UC-R-01) — approved artboard RiderSavedPlaces: the list
 * with an edit action per place, and the add / edit card (name + a pin on
 * the map). A duplicate name (409 `duplicate_name`, E1) is rejected with a
 * prompt to rename. Places appear as one-tap choices in booking.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import {
  createSavedLocation,
  deleteSavedLocation,
  rideErrorCode,
  type SavedLocation,
  updateSavedLocation,
} from "../../api/rides";
import {
  AppText,
  Banner,
  DestructiveTextButton,
  EmptyView,
  ErrorView,
  LoadingView,
  PrimaryButton,
  ScreenScrollView,
  screenStyles,
  TextButton,
  TextField,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { useCurrentPosition } from "../../location/use-current-position";
import type { LatLng } from "../../map/geo";
import { placeCoordsLabel } from "../../ride/ride-format";
import { useSavedPlaces } from "../../ride/use-saved-places";
import { colors, radius, spacing } from "../../theme/tokens";
import { PinPicker } from "./pin-picker";
import { savedPlaceIcon } from "./route-planner";

export default function SavedPlacesScreen() {
  const { t } = useLocale();
  const { row } = useDirection();
  const saved = useSavedPlaces();
  const current = useCurrentPosition();
  const [editing, setEditing] = useState<SavedLocation | null>(null);
  const [name, setName] = useState("");
  const [point, setPoint] = useState<LatLng | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setEditing(null);
    setName("");
    setPoint(null);
    setNameError(null);
    setError(null);
  };

  const startEdit = (place: SavedLocation) => {
    setEditing(place);
    setName(place.name);
    setPoint({ lat: place.lat, lng: place.lng });
    setNameError(null);
    setError(null);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t("savedPlaces.nameRequired"));
      return;
    }
    if (!point) {
      setError(t("savedPlaces.locationRequired"));
      return;
    }
    setNameError(null);
    setError(null);
    setBusy(true);
    const body = {
      name: trimmed,
      lat: point.lat,
      lng: point.lng,
      address: editing?.address ?? null,
    };
    try {
      if (editing) {
        const updated = await updateSavedLocation(editing.id, body);
        saved.setPlaces((list) =>
          list.map((item) => (item.id === updated.id ? updated : item)),
        );
      } else {
        const created = await createSavedLocation(body);
        saved.setPlaces((list) => [...list, created]);
      }
      reset();
    } catch (failure) {
      if (rideErrorCode(failure) === "duplicate_name") {
        setNameError(t("savedPlaces.duplicate", { name: trimmed }));
      } else {
        setError(t("savedPlaces.saveFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSavedLocation(editing.id);
      saved.setPlaces((list) => list.filter((item) => item.id !== editing.id));
      reset();
    } catch {
      setError(t("savedPlaces.deleteFailed"));
    } finally {
      setBusy(false);
    }
  };

  const pinStart: LatLng | null =
    point ??
    current.position ??
    (saved.places[0]
      ? { lat: saved.places[0].lat, lng: saved.places[0].lng }
      : null);

  if (picking && pinStart) {
    return (
      <PinPicker
        initial={pinStart}
        onBack={() => setPicking(false)}
        onConfirm={(chosen) => {
          setPoint(chosen);
          setError(null);
          setPicking(false);
        }}
      />
    );
  }

  if (saved.status === "loading") return <LoadingView testID="saved-loading" />;
  if (saved.status === "error") {
    return (
      <ErrorView
        kind={saved.failure ?? "network"}
        onRetry={() => void saved.reload()}
      />
    );
  }

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      keyboardShouldPersistTaps="handled"
      testID="saved-places-screen"
    >
      <AppText variant="body" tone="secondary">
        {t("savedPlaces.intro")}
      </AppText>

      {saved.places.length === 0 ? (
        <EmptyView
          icon="location-outline"
          title={t("savedPlaces.emptyTitle")}
          body={t("savedPlaces.emptyBody")}
          testID="saved-empty"
        />
      ) : (
        <View>
          {saved.places.map((place, index) => (
            <View
              key={place.id}
              style={[
                styles.placeRow,
                { flexDirection: row },
                index < saved.places.length - 1 && styles.divider,
              ]}
              testID={`saved-place-${place.id}`}
            >
              <View style={styles.iconWell}>
                <Ionicons
                  name={savedPlaceIcon(place.name)}
                  size={20}
                  color={colors.text}
                />
              </View>
              <View style={styles.flex}>
                <AppText variant="bodyStrong" weight={800}>
                  {place.name}
                </AppText>
                <AppText variant="caption" tone="secondary" weight={400}>
                  {place.address ?? placeCoordsLabel(place)}
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("savedPlaces.edit", { name: place.name })}
                onPress={() => startEdit(place)}
                style={styles.editButton}
                testID={`saved-edit-${place.id}`}
              >
                <Ionicons name="pencil" size={18} color={colors.text} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View style={styles.card} testID="saved-form">
        <AppText variant="bodyStrong" weight={800}>
          {editing ? t("savedPlaces.editTitle") : t("savedPlaces.addTitle")}
        </AppText>
        <TextField
          label={t("savedPlaces.name")}
          value={name}
          onChangeText={(text) => {
            setName(text);
            setNameError(null);
          }}
          maxLength={50}
          error={nameError}
          style={styles.whiteInput}
          testID="saved-name"
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => setPicking(true)}
          disabled={!pinStart}
          style={({ pressed }) => [
            styles.pinButton,
            { flexDirection: row },
            pressed && styles.pressed,
            !pinStart && styles.disabled,
          ]}
          testID="saved-pick-location"
        >
          <Ionicons name="location-outline" size={18} color={colors.text} />
          <AppText variant="label" weight={700} style={styles.flex}>
            {point
              ? `${t("savedPlaces.changeLocation")} · ${placeCoordsLabel(point)}`
              : t("savedPlaces.pickLocation")}
          </AppText>
        </Pressable>
        {error ? (
          <Banner tone="danger" message={error} testID="saved-error" />
        ) : null}
        {editing ? (
          <View style={[styles.editActions, { flexDirection: row }]}>
            <TextButton
              label={t("savedPlaces.cancelEdit")}
              onPress={reset}
              testID="saved-cancel-edit"
            />
            <DestructiveTextButton
              label={t("savedPlaces.delete")}
              onPress={() => void remove()}
              disabled={busy}
              testID="saved-delete"
            />
          </View>
        ) : null}
      </View>

      <PrimaryButton
        label={editing ? t("savedPlaces.saveChanges") : t("savedPlaces.save")}
        onPress={() => void save()}
        loading={busy}
        testID="saved-save"
      />
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  placeRow: {
    alignItems: "center",
    gap: 14,
    paddingVertical: 10,
    minHeight: 64,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  iconWell: {
    width: 44,
    height: 44,
    borderRadius: radius.round,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  flex: {
    flex: 1,
  },
  editButton: {
    width: 48,
    height: 48,
    borderRadius: radius.round,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 10,
  },
  pinButton: {
    minHeight: 48,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: "center",
    gap: 10,
    paddingHorizontal: spacing.md,
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.4,
  },
  whiteInput: {
    backgroundColor: colors.surface,
  },
  editActions: {
    justifyContent: "space-between",
  },
});
