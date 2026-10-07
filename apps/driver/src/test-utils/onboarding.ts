import { fireEvent, screen } from "@testing-library/react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

import type {
  ApplicationStatus,
  DocumentSlot,
  DocumentType,
  DriverApplication,
  DriverDocument,
  FileRef,
  VehicleWithDocuments,
} from "../api/onboarding-types";
import { fromIsoDate, toIsoDate } from "../onboarding/dates";

/** Fixtures + interaction helpers for the onboarding contract (onboarding-v1.yaml). */

export function isoInDays(days: number): string {
  const now = new Date();
  return toIsoDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days),
  );
}

export function fileRef(
  id: string,
  contentType: FileRef["contentType"] = "image/jpeg",
): FileRef {
  return {
    fileId: id,
    contentType,
    url: `/api/v1/files/token-${id}`,
    urlExpiresAt: "2026-10-06T10:05:00Z",
  };
}

export function documentFixture(
  type: DocumentType,
  overrides: Partial<DriverDocument> = {},
): DriverDocument {
  return {
    id: `doc-${type}`,
    type,
    vehicleId:
      type === "vehicle_registration" || type === "insurance" ? "veh-1" : null,
    number: `${type.toUpperCase()}-1`,
    expiresOn: isoInDays(200),
    file: fileRef(`file-${type}`),
    reviewStatus: "pending",
    reviewNote: null,
    submittedAt: "2026-10-01T09:00:00Z",
    ...overrides,
  };
}

export function vehicleFixture(
  overrides: Partial<VehicleWithDocuments> = {},
): VehicleWithDocuments {
  return {
    id: "veh-1",
    make: "Kia",
    model: "Rio",
    year: 2018,
    color: "White",
    plate: "DAM123456",
    seats: 4,
    photos: [fileRef("photo-1"), fileRef("photo-2")],
    reviewStatus: "pending",
    reviewNote: null,
    active: false,
    serviceTypes: [],
    submittedAt: "2026-10-01T09:00:00Z",
    documents: [],
    ...overrides,
  };
}

export function applicationFixture(
  status: ApplicationStatus,
  overrides: Partial<DriverApplication> = {},
): DriverApplication {
  return {
    id: "app-1",
    status,
    submittedAt: "2026-10-01T09:00:00Z",
    decidedAt: null,
    rejectionReason: null,
    personal: {
      name: "Rami Rider",
      photo: fileRef("profile-photo"),
      reviewStatus: "pending",
      reviewNote: null,
    },
    documents: (
      [
        "government_id",
        "drivers_license",
        "vehicle_registration",
        "insurance",
      ] as DocumentType[]
    ).map((type) => documentFixture(type)),
    vehicle: vehicleFixture(),
    history: [
      {
        fromStatus: null,
        toStatus: "submitted",
        note: null,
        at: "2026-10-01T09:00:00Z",
      },
    ],
    ...overrides,
  };
}

export function slotFixture(
  type: DocumentType,
  overrides: Partial<DocumentSlot> = {},
): DocumentSlot {
  return {
    type,
    vehicleId:
      type === "vehicle_registration" || type === "insurance" ? "veh-1" : null,
    current: documentFixture(type, { reviewStatus: "approved" }),
    expired: false,
    renewal: null,
    ...overrides,
  };
}

export function uploaded(fileId: string, contentType = "image/jpeg") {
  return {
    status: 201,
    body: { fileId, kind: "document", contentType, sizeBytes: 2048 },
  };
}

/** Next document-picker result: one file. */
export function mockDocumentPick(
  name = "scan.pdf",
  mimeType = "application/pdf",
  size = 4096,
) {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
    canceled: false,
    assets: [
      { uri: `file:///tmp/${name}`, name, mimeType, size, lastModified: 0 },
    ],
  } as Awaited<ReturnType<typeof DocumentPicker.getDocumentAsync>>);
}

/** Next photo-library result: one image. */
export function mockLibraryPick(
  fileName = "photo.jpg",
  mimeType = "image/jpeg",
) {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
    canceled: false,
    assets: [
      {
        uri: `file:///tmp/${fileName}`,
        fileName,
        mimeType,
        width: 100,
        height: 100,
        fileSize: 2048,
      },
    ],
  } as Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>);
}

/** Picks `iso` in the DateField identified by `testID` (iOS inline picker in tests). */
export function pickDate(testID: string, iso: string) {
  if (!screen.queryByTestId(`${testID}-picker`)) {
    fireEvent.press(screen.getByTestId(testID));
  }
  fireEvent(
    screen.getByTestId(`${testID}-picker`),
    "valueChange",
    { nativeEvent: { timestamp: 0, utcOffset: 0 } },
    fromIsoDate(iso),
  );
}
