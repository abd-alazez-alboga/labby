import { useRouter } from "expo-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { ApiError, isAccountSuspendedError } from "../../api/client";
import { rideErrorOf } from "../../api/rides";
import { submitReport, uploadReportFile } from "../../api/trust";
import {
  DRIVER_REPORT_CATEGORIES,
  REPORT_PHOTOS_MAX,
  REPORT_TEXT_MAX,
} from "../../api/trust-types";
import type { ReportCategory } from "../../api/trust-types";
import { pickFile } from "../../onboarding/file-picking";
import { colors, radius, spacing } from "../../theme/tokens";
import { formatCount, formatDayMonthTime } from "../../trust/format";
import {
  AppText,
  Banner,
  FieldError,
  Icon,
  PrimaryButton,
  Screen,
  TextField,
  useDirection,
} from "../ui";

interface Photo {
  fileId: string;
  uri: string;
}

type SendError =
  | "already"
  | "noCounterpart"
  | "invalid"
  | "network"
  | "server"
  /** 403 `account_suspended` (USR-06) — final, never retried. */
  | "accountSuspended";

/** Refusals that end the report for good: Send stays disabled. */
function isFinal(error: SendError | null): boolean {
  return error === "already" || error === "accountSuspended";
}

function sendErrorOf(caught: unknown): SendError {
  if (isAccountSuspendedError(caught)) return "accountSuspended";
  const coded = rideErrorOf(caught);
  if (!coded) return "network";
  if (coded.status === 409) {
    return coded.code === "report_already_submitted" ? "already" : "noCounterpart";
  }
  if (coded.status === 400) return "invalid";
  return "server";
}

/** Upload failures → i18n keys (400 type/unreadable, 413 size, 429 daily cap). */
function uploadErrorKey(error: unknown): string {
  if (isAccountSuspendedError(error)) return "trust.errors.accountSuspended";
  if (error instanceof ApiError) {
    if (error.status === 400) return "onboarding.file.rejected";
    if (error.status === 413) return "onboarding.file.tooLarge";
    if (error.status === 429) return "onboarding.file.dailyLimit";
    return "trust.report.errors.server";
  }
  return "trust.report.errors.network";
}

/**
 * UC-S-18 for the driver (artboard "Driver Report rider"): the four
 * driver → rider categories, optional text (≤ 2000), up to 3 photos
 * uploaded first through `POST /report-files` (each removable before
 * sending — a removed upload is simply not referenced), then `POST /rides/{id}/reports`.
 * Sent → the reports list with the "Report sent" confirmation.
 */
export function ReportRiderScreen({
  rideId,
  name,
  when,
  place,
}: {
  rideId: string;
  name: string;
  /** The trip's completion (or acceptance) time, ISO. */
  when?: string | null;
  place?: string | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { language, flipRows } = useDirection();
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const riderName = name.trim() || t("ride.theRider");

  const addPhoto = async () => {
    if (uploading || photos.length >= REPORT_PHOTOS_MAX) return;
    setUploadError(null);
    setUploading(true);
    try {
      const picked = await pickFile("vehicle_photo", "library");
      if (picked.status === "canceled") return;
      if (picked.status === "invalid") {
        setUploadError(picked.errorKey);
        return;
      }
      const uploaded = await uploadReportFile(picked.file);
      setPhotos((list) =>
        list.length >= REPORT_PHOTOS_MAX
          ? list
          : [...list, { fileId: uploaded.fileId, uri: picked.file.uri }],
      );
    } catch (caught) {
      setUploadError(uploadErrorKey(caught));
    } finally {
      setUploading(false);
    }
  };

  const send = async () => {
    if (!category || sending || uploading) return;
    setSending(true);
    setError(null);
    try {
      await submitReport(rideId, {
        category,
        description: description.trim() || null,
        photoFileIds: photos.map((photo) => photo.fileId),
      });
      router.replace({ pathname: "/reports", params: { sent: "1" } });
    } catch (caught) {
      setError(sendErrorOf(caught));
      setSending(false);
    }
  };

  const tripLine = when
    ? place
      ? t("trust.report.tripAt", {
          when: formatDayMonthTime(when, language),
          place,
        })
      : t("trust.report.trip", { when: formatDayMonthTime(when, language) })
    : null;

  return (
    <Screen
      keyboardShouldPersistTaps="handled"
      testID="report-rider-screen"
      footer={
        <>
          <AppText variant="caption" weight="400" color={colors.textSecondary}>
            {t("trust.report.privacy", { name: riderName })}
          </AppText>
          <PrimaryButton
            title={t("trust.report.send")}
            onPress={() => void send()}
            disabled={!category || uploading || isFinal(error)}
            busy={sending}
            testID="report-send"
          />
        </>
      }
    >
      <View style={styles.heading}>
        <AppText variant="display" accessibilityRole="header" testID="report-title">
          {t("trust.report.title", { name: riderName })}
        </AppText>
        {tripLine ? (
          <AppText variant="secondary" color={colors.textSecondary} testID="report-trip">
            {tripLine}
          </AppText>
        ) : null}
      </View>

      <View accessibilityRole="radiogroup" style={styles.options}>
        <AppText variant="bodyStrong" weight="800">
          {t("trust.report.question")}
        </AppText>
        {DRIVER_REPORT_CATEGORIES.map((option) => {
          const selected = category === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => {
                if (sending) return;
                setCategory(option);
                if (!isFinal(error)) setError(null);
              }}
              style={[
                styles.option,
                selected && styles.optionSelected,
                flipRows && styles.rowReverse,
              ]}
              testID={`report-category-${option}`}
            >
              <View style={[styles.radio, selected && styles.radioSelected]}>
                {selected ? <View style={styles.radioDot} /> : null}
              </View>
              <AppText variant="bodyStrong" weight={selected ? "800" : "700"} style={styles.grow}>
                {t(`trust.report.categories.${option}`)}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <TextField
        label={t("trust.report.detailsLabel")}
        value={description}
        onChangeText={setDescription}
        maxLength={REPORT_TEXT_MAX}
        multiline
        textAlignVertical="top"
        testID="report-description"
      />

      <View style={styles.photos}>
        <AppText variant="label" weight="700" color={colors.textSecondary}>
          {t("trust.report.photos", {
            max: formatCount(REPORT_PHOTOS_MAX, language),
          })}
        </AppText>
        <View style={[styles.photoRow, flipRows && styles.rowReverse]}>
          {photos.map((photo, index) => (
            <View key={photo.fileId} style={styles.photoFrame}>
              <Image
                source={{ uri: photo.uri }}
                style={styles.photo}
                accessibilityLabel={t("trust.report.photo", {
                  n: formatCount(index + 1, language),
                })}
                testID={`report-photo-${index}`}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("trust.report.removePhoto", {
                  n: formatCount(index + 1, language),
                })}
                onPress={() => {
                  if (sending) return;
                  setPhotos((list) =>
                    list.filter((item) => item.fileId !== photo.fileId),
                  );
                }}
                hitSlop={spacing.sm}
                style={[styles.remove, flipRows ? styles.removeStart : styles.removeEnd]}
                testID={`report-photo-remove-${index}`}
              >
                <Icon name="close" size={16} color={colors.onAccent} />
              </Pressable>
            </View>
          ))}
          {photos.length < REPORT_PHOTOS_MAX ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("trust.report.addPhoto")}
              accessibilityState={{ disabled: uploading, busy: uploading }}
              onPress={() => void addPhoto()}
              style={[styles.photo, styles.addPhoto]}
              testID="report-add-photo"
            >
              {uploading ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Icon name="add" size={24} color={colors.textSecondary} />
              )}
            </Pressable>
          ) : null}
        </View>
        {uploadError ? (
          <FieldError testID="report-photo-error">{t(uploadError)}</FieldError>
        ) : null}
      </View>

      {error ? (
        <Banner
          tone={isFinal(error) ? "neutral" : "danger"}
          message={t(
            error === "accountSuspended"
              ? "trust.errors.accountSuspended"
              : `trust.report.errors.${error}`,
          )}
          testID={`report-error-${error}`}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs },
  options: { gap: spacing.sm },
  option: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.ms,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
  },
  optionSelected: {
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  rowReverse: { flexDirection: "row-reverse" },
  grow: { flex: 1 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: colors.accent },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  photos: { gap: spacing.sm },
  photoRow: { flexDirection: "row", gap: 10 },
  photoFrame: { width: 88, height: 88 },
  remove: {
    position: "absolute",
    top: -spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.text,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  removeEnd: { right: -spacing.sm },
  removeStart: { left: -spacing.sm },
  photo: {
    width: 88,
    height: 88,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
  },
  addPhoto: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.textSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
});
