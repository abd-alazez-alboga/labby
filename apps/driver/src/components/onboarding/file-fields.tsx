import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { ApiError } from "../../api/client";
import { uploadDriverFile } from "../../api/onboarding";
import type { FileKind } from "../../api/onboarding-types";
import { VEHICLE_PHOTOS_MAX } from "../../api/onboarding-types";
import type { PickedFile } from "../../onboarding/drafts";
import { pickFile } from "../../onboarding/file-picking";
import type { PickSource } from "../../onboarding/file-picking";
import { colors, radius, spacing } from "../../theme/tokens";
import {
  AppText,
  FieldError,
  FieldLabel,
  Muted,
  SecondaryButton,
  useDirection,
} from "../ui";
import { FilePreview } from "./ui";

/** Upload failures → i18n keys (contract: 400 type/unreadable, 413 size, 429 daily cap). */
function uploadErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return "onboarding.file.rejected";
    if (error.status === 413) return "onboarding.file.tooLarge";
    if (error.status === 429) return "onboarding.file.dailyLimit";
    return "onboarding.errors.server";
  }
  return "onboarding.errors.network";
}

/**
 * Pick (camera / library / files) → client-side type+size check → upload
 * through `POST /driver/files` → a PickedFile carrying the server fileId.
 */
function useUploader(kind: FileKind) {
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const pickAndUpload = async (
    source: PickSource,
  ): Promise<PickedFile | null> => {
    setErrorKey(null);
    setBusy(true);
    try {
      const picked = await pickFile(kind, source);
      if (picked.status === "canceled") return null;
      if (picked.status === "invalid") {
        setErrorKey(picked.errorKey);
        return null;
      }
      const uploaded = await uploadDriverFile(picked.file, kind);
      return {
        fileId: uploaded.fileId,
        previewUri: picked.file.uri,
        name: picked.file.name,
        mimeType: uploaded.contentType,
      };
    } catch (error) {
      setErrorKey(uploadErrorKey(error));
      return null;
    } finally {
      setBusy(false);
    }
  };

  return { busy, errorKey, pickAndUpload };
}

function SourceButtons({
  sources,
  onPick,
  disabled,
  testID,
}: {
  sources: readonly PickSource[];
  onPick: (source: PickSource) => void;
  disabled: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  const icons: Record<
    PickSource,
    React.ComponentProps<typeof Ionicons>["name"]
  > = {
    camera: "camera-outline",
    library: "images-outline",
    files: "folder-open-outline",
  };
  return (
    <View style={styles.sources}>
      {sources.map((source) => (
        <SecondaryButton
          key={source}
          title={t(`onboarding.file.source.${source}`)}
          icon={icons[source]}
          onPress={() => onPick(source)}
          disabled={disabled}
          testID={`${testID}-${source}`}
        />
      ))}
    </View>
  );
}

/** One document file (JPEG/PNG/PDF): preview + replace via camera/library/files. */
export function DocumentFileField({
  value,
  onChange,
  error,
  testID,
}: {
  value: PickedFile | null;
  onChange: (file: PickedFile) => void;
  error?: string | null;
  testID: string;
}) {
  const { t } = useTranslation();
  const uploader = useUploader("document");

  const onPick = async (source: PickSource) => {
    const file = await uploader.pickAndUpload(source);
    if (file) onChange(file);
  };

  return (
    <View style={styles.field}>
      <View>
        <FieldLabel>{t("onboarding.document.file")}</FieldLabel>
        <Muted>{t("onboarding.document.fileHint")}</Muted>
      </View>
      {value ? <FilePreview file={value} testID={`${testID}-preview`} /> : null}
      {uploader.busy ? (
        <View style={styles.busy} testID={`${testID}-uploading`}>
          <ActivityIndicator color={colors.accent} />
          <Muted>{t("onboarding.file.uploading")}</Muted>
        </View>
      ) : (
        <SourceButtons
          sources={["camera", "library", "files"]}
          onPick={(source) => void onPick(source)}
          disabled={uploader.busy}
          testID={testID}
        />
      )}
      {uploader.errorKey ? (
        <FieldError testID={`${testID}-upload-error`}>
          {t(uploader.errorKey)}
        </FieldError>
      ) : error ? (
        <FieldError testID={`${testID}-error`}>{error}</FieldError>
      ) : null}
    </View>
  );
}

/** 1..4 vehicle photos (JPEG/PNG), first one shown to riders. */
export function VehiclePhotosField({
  value,
  onChange,
  error,
  testID,
}: {
  value: PickedFile[];
  onChange: (photos: PickedFile[]) => void;
  error?: string | null;
  testID: string;
}) {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  const uploader = useUploader("vehicle_photo");
  const full = value.length >= VEHICLE_PHOTOS_MAX;

  const onPick = async (source: PickSource) => {
    const file = await uploader.pickAndUpload(source);
    if (file) onChange([...value, file]);
  };

  return (
    <View style={styles.field}>
      <Muted>
        {t("onboarding.vehicle.photosHint", { max: VEHICLE_PHOTOS_MAX })}
      </Muted>
      <View style={[styles.grid, flipRows && styles.gridReverse]}>
        {value.map((photo, index) => (
          <View
            key={photo.fileId}
            style={styles.tile}
            testID={`${testID}-tile-${index}`}
          >
            <Image
              source={{ uri: photo.previewUri }}
              style={styles.tileImage}
            />
            {index === 0 ? (
              <View style={styles.coverBadge}>
                <AppText
                  variant="caption"
                  weight="700"
                  color={colors.onAccent}
                  align="center"
                >
                  {t("onboarding.vehicle.coverPhoto")}
                </AppText>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("onboarding.vehicle.removePhoto")}
              onPress={() => onChange(value.filter((_, i) => i !== index))}
              style={styles.remove}
              testID={`${testID}-remove-${index}`}
              hitSlop={spacing.sm}
            >
              <Ionicons name="close" size={16} color={colors.onAccent} />
            </Pressable>
          </View>
        ))}
      </View>
      <Muted testID={`${testID}-count`}>
        {t("onboarding.vehicle.photoCount", {
          count: value.length,
          max: VEHICLE_PHOTOS_MAX,
        })}
      </Muted>
      {uploader.busy ? (
        <View style={styles.busy} testID={`${testID}-uploading`}>
          <ActivityIndicator color={colors.accent} />
          <Muted>{t("onboarding.file.uploading")}</Muted>
        </View>
      ) : full ? null : (
        <SourceButtons
          sources={["camera", "library"]}
          onPick={(source) => void onPick(source)}
          disabled={uploader.busy}
          testID={testID}
        />
      )}
      {uploader.errorKey ? (
        <FieldError testID={`${testID}-upload-error`}>
          {t(uploader.errorKey)}
        </FieldError>
      ) : error ? (
        <FieldError testID={`${testID}-error`}>{error}</FieldError>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.ms, marginBottom: spacing.sm },
  sources: { gap: spacing.sm },
  busy: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  gridReverse: { flexDirection: "row-reverse" },
  tile: {
    width: 96,
    height: 96,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.surfaceMap,
  },
  tileImage: { width: "100%", height: "100%" },
  coverBadge: {
    position: "absolute",
    bottom: 0,
    start: 0,
    end: 0,
    backgroundColor: colors.accent,
    paddingVertical: 2,
  },
  remove: {
    position: "absolute",
    top: 4,
    end: 4,
    backgroundColor: colors.text,
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
