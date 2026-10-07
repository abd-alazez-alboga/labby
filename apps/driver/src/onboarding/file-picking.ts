import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

import type { LocalFile } from "../api/onboarding";
import type { FileKind } from "../api/onboarding-types";
import { DRIVER_FILE_MAX_BYTES } from "../api/onboarding-types";
import { runExclusive } from "../permissions/permission-queue";

/**
 * Picking files for the onboarding forms: camera, photo library, or the
 * system file picker (documents may be PDFs). Type and size are checked
 * BEFORE any upload; the server re-detects the type from the bytes.
 */

export type PickSource = "camera" | "library" | "files";

export const ACCEPTED_TYPES: Record<FileKind, readonly string[]> = {
  document: ["image/jpeg", "image/png", "application/pdf"],
  vehicle_photo: ["image/jpeg", "image/png"],
};

export type PickResult =
  | { status: "picked"; file: LocalFile }
  | { status: "canceled" }
  | { status: "invalid"; errorKey: string };

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
};

function normalizeType(
  mimeType: string | null | undefined,
  name: string,
): string {
  const lowered = mimeType?.toLowerCase();
  if (lowered === "image/jpg") return "image/jpeg";
  if (lowered) return lowered;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? "application/octet-stream";
}

function check(
  kind: FileKind,
  uri: string,
  name: string,
  mimeType: string | null | undefined,
  size: number | null | undefined,
): PickResult {
  const type = normalizeType(mimeType, name);
  if (!ACCEPTED_TYPES[kind].includes(type)) {
    return {
      status: "invalid",
      errorKey:
        kind === "document"
          ? "onboarding.file.wrongTypeDocument"
          : "onboarding.file.wrongTypePhoto",
    };
  }
  if (typeof size === "number" && size > DRIVER_FILE_MAX_BYTES) {
    return { status: "invalid", errorKey: "onboarding.file.tooLarge" };
  }
  return { status: "picked", file: { uri, name, mimeType: type } };
}

function defaultName(type: string | null | undefined): string {
  return type === "image/png" ? "photo.png" : "photo.jpg";
}

async function fromImagePicker(
  kind: FileKind,
  source: "camera" | "library",
): Promise<PickResult> {
  if (source === "camera") {
    const permission = await runExclusive(() =>
      ImagePicker.requestCameraPermissionsAsync(),
    );
    if (!permission.granted) {
      return { status: "invalid", errorKey: "onboarding.file.cameraDenied" };
    }
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    // < 1 also makes iOS hand back JPEG instead of HEIC.
    quality: 0.8,
  };
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets?.[0];
  if (!asset) return { status: "canceled" };
  return check(
    kind,
    asset.uri,
    asset.fileName ?? defaultName(asset.mimeType),
    asset.mimeType,
    asset.fileSize,
  );
}

async function fromFiles(kind: FileKind): Promise<PickResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [...ACCEPTED_TYPES[kind]],
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = result.canceled ? null : result.assets?.[0];
  if (!asset) return { status: "canceled" };
  return check(kind, asset.uri, asset.name, asset.mimeType, asset.size);
}

export function pickFile(
  kind: FileKind,
  source: PickSource,
): Promise<PickResult> {
  return source === "files" ? fromFiles(kind) : fromImagePicker(kind, source);
}
