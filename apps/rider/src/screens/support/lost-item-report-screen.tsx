/**
 * Report a lost item (UC-R-20, LOST-01) — approved artboard R14LostReport:
 * reached from a completed ride in history, with the ride row on top, the
 * description, up to 3 photos (uploaded as `lost_item_photo` when picked)
 * and the note that the ride chat reopens. Submitting opens the case.
 */
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { ApiError, failureKind, type FailureKind } from "../../api/http-client";
import { getRide, type Ride } from "../../api/rides";
import {
  LOST_ITEM_PHOTOS_MAX,
  reportLostItem,
  TICKET_DESCRIPTION_MAX,
  uploadTicketFile,
} from "../../api/support";
import {
  AppText,
  Banner,
  ErrorView,
  LoadingView,
  PrimaryButton,
  ScreenScrollView,
  screenStyles,
  TextField,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { formatDateTime } from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";

interface PickedPhoto {
  key: string;
  uri: string;
  fileId: string | null;
}

function uploadErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) return "ticketCreate.errors.upload_too_large";
    if (error.status === 429) return "ticketCreate.errors.upload_limit";
  }
  return "ticketCreate.errors.upload_failed";
}

export default function LostItemReportScreen({ rideId }: { rideId: string }) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const router = useRouter();
  const [ride, setRide] = useState<Ride | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [failure, setFailure] = useState<FailureKind>("network");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nextKey = useRef(0);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setRide(await getRide(rideId));
      setStatus("ready");
    } catch (error) {
      setFailure(failureKind(error));
      setStatus("error");
    }
  }, [rideId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const addPhoto = async () => {
    if (photos.length >= LOST_ITEM_PHOTOS_MAX) return;
    setPhotoError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const key = `photo-${nextKey.current++}`;
    setPhotos((list) =>
      list.length >= LOST_ITEM_PHOTOS_MAX
        ? list
        : [...list, { key, uri: asset.uri, fileId: null }],
    );
    try {
      const uploaded = await uploadTicketFile(
        {
          uri: asset.uri,
          name: asset.fileName ?? "lost-item.jpg",
          type: asset.mimeType ?? "image/jpeg",
        },
        "lost_item_photo",
      );
      setPhotos((list) =>
        list.map((photo) =>
          photo.key === key ? { ...photo, fileId: uploaded.fileId } : photo,
        ),
      );
    } catch (error) {
      setPhotos((list) => list.filter((photo) => photo.key !== key));
      setPhotoError(t(uploadErrorKey(error)));
    }
  };

  const uploading = photos.some((photo) => photo.fileId === null);

  const send = async () => {
    if (busy || uploading) return;
    const text = description.trim();
    if (!text) {
      setSendError(t("lostItem.errors.description_required"));
      return;
    }
    setBusy(true);
    setSendError(null);
    try {
      const opened = await reportLostItem(rideId, {
        description: text,
        photoFileIds: photos
          .map((photo) => photo.fileId)
          .filter((id): id is string => id !== null),
      });
      router.replace(
        `/lost-item/${encodeURIComponent(opened.ticketId)}` as never,
      );
    } catch (error) {
      const code =
        error instanceof ApiError ? (error.body?.code ?? null) : null;
      setSendError(
        code === "ride_not_completed" || code === "lost_item_case_open"
          ? t(`lostItem.errors.${code}`)
          : t("lostItem.errors.generic"),
      );
    } finally {
      setBusy(false);
    }
  };

  if (status === "error") {
    return <ErrorView kind={failure} onRetry={() => void load()} />;
  }
  if (status === "loading" || !ride) {
    return <LoadingView testID="lost-report-loading" />;
  }

  const driverName = ride.driver?.firstName ?? "";

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      keyboardShouldPersistTaps="handled"
      testID="lost-report"
    >
      <View style={[styles.rideCard, { flexDirection: row }]}>
        <View style={styles.rideIcon}>
          <Ionicons name="car-outline" size={18} color={colors.accent} />
        </View>
        <View style={styles.flex}>
          <AppText
            variant="secondary"
            weight={700}
            numberOfLines={1}
            testID="lost-report-trip"
          >
            {ride.pickup.label && ride.destination.label
              ? t("ride.tripLine", {
                  from: ride.pickup.label,
                  to: ride.destination.label,
                })
              : (ride.destination.label ?? "")}
          </AppText>
          <AppText variant="caption" tone="muted" weight={400}>
            {[
              formatDateTime(ride.timeline.requestedAt, locale),
              driverName || null,
            ]
              .filter((part): part is string => !!part)
              .join(" · ")}
          </AppText>
        </View>
      </View>

      <TextField
        label={t("lostItem.whatLabel")}
        value={description}
        onChangeText={setDescription}
        maxLength={TICKET_DESCRIPTION_MAX}
        multiline
        style={styles.description}
        testID="lost-report-description"
      />

      <View style={styles.group}>
        <AppText variant="label" weight={700} tone="secondary">
          {t("lostItem.photosLabel")}{" "}
          <AppText variant="label" tone="muted">
            · {t("lostItem.photosHint")}
          </AppText>
        </AppText>
        <View style={[styles.tiles, { flexDirection: row }]}>
          {photos.map((photo) => (
            <View key={photo.key} style={styles.tile} testID="lost-report-photo">
              <Image source={{ uri: photo.uri }} style={styles.thumb} />
              {photo.fileId === null ? (
                <View style={styles.tileBusy}>
                  <ActivityIndicator
                    color={colors.accent}
                    testID="lost-report-photo-uploading"
                  />
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("lostItem.removePhoto")}
                hitSlop={13}
                onPress={() =>
                  setPhotos((list) => list.filter((p) => p.key !== photo.key))
                }
                style={styles.remove}
                testID={`lost-report-photo-remove-${photo.key}`}
              >
                <Ionicons name="close" size={14} color={colors.onAccent} />
              </Pressable>
            </View>
          ))}
          {photos.length < LOST_ITEM_PHOTOS_MAX ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("lostItem.addPhoto")}
              onPress={() => void addPhoto()}
              style={({ pressed }) => [styles.addTile, pressed && styles.pressed]}
              testID="lost-report-add-photo"
            >
              <Ionicons name="add" size={26} color={colors.accent} />
            </Pressable>
          ) : null}
        </View>
        {photoError ? (
          <Banner
            tone="danger"
            message={photoError}
            testID="lost-report-photo-error"
          />
        ) : null}
      </View>

      <Banner
        tone="accent"
        message={t("lostItem.chatNote", { name: driverName })}
        testID="lost-report-chat-note"
      />

      <View style={styles.footer}>
        {sendError ? (
          <Banner
            tone="danger"
            message={sendError}
            testID="lost-report-error"
          />
        ) : null}
        <PrimaryButton
          label={t("lostItem.submit")}
          onPress={() => void send()}
          disabled={uploading}
          loading={busy}
          testID="lost-report-send"
        />
      </View>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  rideCard: {
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfacePage,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rideIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  flex: {
    flex: 1,
    gap: 1,
  },
  description: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  group: {
    gap: spacing.sm,
  },
  tiles: {
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  tile: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMap,
  },
  thumb: {
    width: "100%",
    height: "100%",
    borderRadius: radius.sm,
  },
  tileBusy: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.6)",
    borderRadius: radius.sm,
  },
  remove: {
    position: "absolute",
    top: -6,
    end: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
  },
  addTile: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.7,
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
});
