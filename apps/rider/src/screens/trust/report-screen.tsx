/**
 * Report your driver (UC-S-18, REP-01) — approved artboard RiderReport:
 * "Report Samer" + the ride line, the four rider → driver categories as
 * radio cards, optional text (≤ 2000), up to 3 photos, the review footnote
 * (the driver is never told who reported) and Send report.
 *
 * Photos are picked with expo-image-picker (already a dependency, same as
 * the profile photo) and uploaded one by one as they are added
 * (`POST /report-files`, JPEG/PNG); a 400 / 413 / 429 drops that photo with
 * its own message. Sending files the report with the uploaded ids and
 * replaces this screen with "Report sent · Your reports". A 409
 * `report_already_submitted` (one report per ride) points to Your reports;
 * `no_counterpart` explains there is no driver to report.
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
  REPORT_DESCRIPTION_MAX,
  REPORT_MAX_PHOTOS,
  RIDER_REPORT_CATEGORIES,
  type RiderReportCategory,
  submitReport,
  trustErrorCode,
  uploadReportFile,
} from "../../api/trust";
import {
  AppText,
  Banner,
  ErrorView,
  LoadingView,
  PrimaryButton,
  ScreenHeader,
  ScreenScrollView,
  TextButton,
  TextField,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import {
  formatDateTime,
  placeLabel,
} from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";

interface PickedPhoto {
  key: string;
  uri: string;
  fileId: string | null;
}

type SendBlock = "report_already_submitted" | "no_counterpart";

/** The copy key for a failed photo upload (report-files 400 / 413 / 429). */
function photoErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return "report.errors.photoType";
    if (error.status === 413) return "report.errors.photoTooLarge";
    if (error.status === 429) return "report.errors.photoCap";
  }
  return "report.errors.photoFailed";
}

export default function ReportScreen({ rideId }: { rideId: string }) {
  const { t, locale } = useLocale();
  const { row, flipRows } = useDirection();
  const router = useRouter();
  const [ride, setRide] = useState<Ride | null>(null);
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [category, setCategory] = useState<RiderReportCategory | null>(null);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [block, setBlock] = useState<SendBlock | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nextKey = useRef(0);

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

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const addPhoto = async () => {
    if (photos.length >= REPORT_MAX_PHOTOS) return;
    setPhotoError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const key = `photo-${nextKey.current++}`;
    setPhotos((list) =>
      list.length >= REPORT_MAX_PHOTOS
        ? list
        : [...list, { key, uri: asset.uri, fileId: null }],
    );
    try {
      const uploaded = await uploadReportFile({
        uri: asset.uri,
        name: asset.fileName ?? "report.jpg",
        type: asset.mimeType ?? "image/jpeg",
      });
      setPhotos((list) =>
        list.map((photo) =>
          photo.key === key ? { ...photo, fileId: uploaded.fileId } : photo,
        ),
      );
    } catch (error) {
      setPhotos((list) => list.filter((photo) => photo.key !== key));
      setPhotoError(t(photoErrorKey(error)));
    }
  };

  const removePhoto = (key: string) => {
    setPhotos((list) => list.filter((photo) => photo.key !== key));
  };

  const uploading = photos.some((photo) => photo.fileId === null);

  const send = async () => {
    if (!category || busy || uploading) return;
    setBusy(true);
    setSendError(null);
    try {
      const text = description.trim();
      await submitReport(rideId, {
        category,
        description: text ? text : null,
        photoFileIds: photos
          .map((photo) => photo.fileId)
          .filter((id): id is string => id !== null),
      });
      router.replace("/reports?sent=1" as never);
    } catch (error) {
      const code = trustErrorCode(error);
      if (code === "report_already_submitted" || code === "no_counterpart") {
        setBlock(code);
      } else if (error instanceof ApiError) {
        setSendError(t("report.errors.generic"));
      } else {
        setSendError(t("common.networkError"));
      }
    } finally {
      setBusy(false);
    }
  };

  if (failure) return <ErrorView kind={failure} onRetry={() => void load()} />;
  if (!ride) return <LoadingView testID="report-loading" />;

  const name = ride.driver?.firstName ?? "";
  const at =
    ride.timeline.startedAt ??
    ride.timeline.acceptedAt ??
    ride.timeline.requestedAt;

  return (
    <View style={styles.page}>
      <ScreenHeader
        title={t("report.title", { name })}
        onBack={back}
        testID="report-header"
      />
      <ScreenScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="report-screen"
      >
        <AppText variant="secondary" tone="secondary" style={styles.rideLine}>
          {t("report.rideLine", {
            date: formatDateTime(at, locale),
            place: placeLabel(ride.destination),
          })}
        </AppText>

        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t("report.question")}
          style={styles.categories}
          testID="report-categories"
        >
          <AppText variant="bodyStrong" weight={800} style={styles.legend}>
            {t("report.question")}
          </AppText>
          {RIDER_REPORT_CATEGORIES.map((value) => {
            const selected = category === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={t(`report.categories.${value}`)}
                onPress={() => setCategory(value)}
                style={[
                  styles.category,
                  { flexDirection: row },
                  selected ? styles.categorySelected : styles.categoryIdle,
                ]}
                testID={`report-category-${value}`}
              >
                <Ionicons
                  name={selected ? "radio-button-on" : "radio-button-off"}
                  size={22}
                  color={selected ? colors.accent : colors.textMuted}
                />
                <AppText variant="bodyStrong" weight={selected ? 800 : 700}>
                  {t(`report.categories.${value}`)}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <TextField
          label={t("report.detailsLabel")}
          value={description}
          onChangeText={setDescription}
          maxLength={REPORT_DESCRIPTION_MAX}
          multiline
          style={styles.details}
          testID="report-details"
        />

        <View style={styles.photos}>
          <AppText variant="label" weight={700} tone="secondary">
            {t("report.photosLabel")}
          </AppText>
          <View style={[styles.photoRow, { flexDirection: row }]}>
            {photos.map((photo) => (
              <View key={photo.key} style={styles.tile} testID="report-photo">
                <Image source={{ uri: photo.uri }} style={styles.thumb} />
                {photo.fileId === null ? (
                  <View style={styles.tileBusy}>
                    <ActivityIndicator
                      color={colors.onAccent}
                      testID="report-photo-uploading"
                    />
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("report.removePhoto")}
                    onPress={() => removePhoto(photo.key)}
                    hitSlop={10}
                    style={[
                      styles.remove,
                      flipRows ? styles.removeRtl : styles.removeLtr,
                    ]}
                    testID="report-photo-remove"
                  >
                    <Ionicons name="close" size={16} color={colors.onAccent} />
                  </Pressable>
                )}
              </View>
            ))}
            {photos.length < REPORT_MAX_PHOTOS ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("report.addPhoto")}
                onPress={() => void addPhoto()}
                style={({ pressed }) => [
                  styles.tile,
                  styles.addTile,
                  pressed && styles.pressed,
                ]}
                testID="report-add-photo"
              >
                <Ionicons name="add" size={26} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>
          {photoError ? (
            <Banner tone="danger" message={photoError} testID="report-photo-error" />
          ) : null}
        </View>

        <View style={styles.footer}>
          <AppText
            variant="caption"
            tone="secondary"
            weight={400}
            style={styles.footnote}
          >
            {t("report.footnote", { name })}
          </AppText>
          {block ? (
            <Banner
              tone="neutral"
              message={t(`report.errors.${block}`)}
              testID="report-blocked"
            />
          ) : null}
          {block === "report_already_submitted" ? (
            <TextButton
              label={t("report.viewReports")}
              onPress={() => router.replace("/reports" as never)}
              testID="report-view-reports"
            />
          ) : null}
          {sendError ? (
            <Banner tone="danger" message={sendError} testID="report-error" />
          ) : null}
          <PrimaryButton
            label={t("report.send")}
            onPress={() => void send()}
            disabled={!category || uploading || block !== null}
            loading={busy}
            testID="report-send"
          />
        </View>
      </ScreenScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: 34,
    gap: 14,
  },
  rideLine: {
    marginTop: -spacing.sm,
  },
  categories: {
    gap: spacing.sm,
  },
  legend: {
    paddingBottom: spacing.xs,
  },
  category: {
    alignItems: "center",
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: radius.md,
  },
  categoryIdle: {
    borderWidth: 1.5,
    borderColor: colors.grabHandle,
  },
  categorySelected: {
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  details: {
    height: 96,
    paddingTop: spacing.md,
    textAlignVertical: "top",
  },
  photos: {
    gap: spacing.sm,
  },
  photoRow: {
    gap: 10,
  },
  tile: {
    width: 88,
    height: 88,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  thumb: {
    width: 88,
    height: 88,
    backgroundColor: colors.grabHandle,
  },
  tileBusy: {
    position: "absolute",
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    backgroundColor: "rgba(20,16,24,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  remove: {
    position: "absolute",
    top: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(20,16,24,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  removeLtr: {
    right: 6,
  },
  removeRtl: {
    left: 6,
  },
  addTile: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.textMuted,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.6,
  },
  footer: {
    marginTop: "auto",
    gap: 10,
    paddingTop: spacing.sm,
  },
  footnote: {
    lineHeight: 20,
  },
});
