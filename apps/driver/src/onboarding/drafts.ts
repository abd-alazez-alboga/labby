import { isAfterToday, maxVehicleYear } from './dates';
import type {
  DocumentInput,
  DocumentType,
  DriverDocument,
  FileContentType,
  FileRef,
  Vehicle,
  VehicleInput,
} from '../api/onboarding-types';
import {
  DOCUMENT_NUMBER_MAX,
  VEHICLE_COLOR_MAX,
  VEHICLE_PHOTOS_MAX,
  VEHICLE_PHOTOS_MIN,
  VEHICLE_PLATE_MAX,
  VEHICLE_SEATS_MAX,
  VEHICLE_SEATS_MIN,
  VEHICLE_TEXT_MAX,
  VEHICLE_YEAR_MIN,
} from '../api/onboarding-types';
import { resolveFileUrl } from '../api/onboarding';

/**
 * Client-side drafts of the onboarding forms plus their validation. Every
 * check runs BEFORE any API call; error values are i18n keys.
 */

/** A file the server already holds (uploaded now, or prefilled from a FileRef). */
export interface PickedFile {
  fileId: string;
  /** Local uri for fresh picks; resolved expiring URL for prefilled files. */
  previewUri: string;
  name: string;
  mimeType: FileContentType | string;
}

export interface DocumentDraft {
  type: DocumentType;
  file: PickedFile | null;
  number: string;
  /** YYYY-MM-DD, or null until picked. */
  expiresOn: string | null;
}

export interface VehicleDraft {
  make: string;
  model: string;
  year: string;
  color: string;
  plate: string;
  seats: string;
  photos: PickedFile[];
}

export type DocumentField = 'file' | 'number' | 'expiresOn';
export type VehicleField = 'make' | 'model' | 'year' | 'color' | 'plate' | 'seats';
export type FieldErrors<F extends string> = Partial<Record<F, string>>;

export function emptyDocument(type: DocumentType): DocumentDraft {
  return { type, file: null, number: '', expiresOn: null };
}

export function emptyVehicle(): VehicleDraft {
  return { make: '', model: '', year: '', color: '', plate: '', seats: '', photos: [] };
}

export function fileFromRef(ref: FileRef, name: string): PickedFile {
  return {
    fileId: ref.fileId,
    previewUri: resolveFileUrl(ref.url),
    name,
    mimeType: ref.contentType,
  };
}

/** Draft prefilled from a document the server already holds (resubmission). */
export function documentFromServer(document: DriverDocument): DocumentDraft {
  return {
    type: document.type,
    file: fileFromRef(document.file, document.type),
    number: document.number,
    expiresOn: document.expiresOn,
  };
}

/** Draft prefilled from the application's vehicle (resubmission). */
export function vehicleFromServer(vehicle: Vehicle): VehicleDraft {
  return {
    make: vehicle.make,
    model: vehicle.model,
    year: String(vehicle.year),
    color: vehicle.color,
    plate: vehicle.plate,
    seats: String(vehicle.seats),
    photos: vehicle.photos.map((photo, index) =>
      fileFromRef(photo, `vehicle-photo-${index + 1}`),
    ),
  };
}

export function validateDocument(
  draft: DocumentDraft,
  now: Date = new Date(),
): FieldErrors<DocumentField> {
  const errors: FieldErrors<DocumentField> = {};
  if (!draft.file) errors.file = 'onboarding.validation.fileRequired';
  const number = draft.number.trim();
  if (number.length === 0) errors.number = 'onboarding.validation.numberRequired';
  else if (number.length > DOCUMENT_NUMBER_MAX)
    errors.number = 'onboarding.validation.numberTooLong';
  if (!draft.expiresOn) errors.expiresOn = 'onboarding.validation.expiryRequired';
  else if (!isAfterToday(draft.expiresOn, now))
    errors.expiresOn = 'onboarding.validation.expired';
  return errors;
}

/** Arabic-Indic / Eastern Arabic digits → ASCII (Arabic keyboards type them). */
export function normalizeDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (digit) =>
    String(digit.charCodeAt(0) & 0xf),
  );
}

function parseWholeNumber(value: string): number | null {
  const trimmed = normalizeDigits(value.trim());
  return /^[0-9]+$/.test(trimmed) ? Number(trimmed) : null;
}

export function validateVehicleDetails(
  draft: VehicleDraft,
  now: Date = new Date(),
): FieldErrors<VehicleField> {
  const errors: FieldErrors<VehicleField> = {};
  const text = (
    field: 'make' | 'model' | 'color' | 'plate',
    max: number,
  ) => {
    const value = draft[field].trim();
    if (value.length === 0) errors[field] = `onboarding.validation.${field}Required`;
    else if (value.length > max) errors[field] = 'onboarding.validation.tooLong';
  };
  text('make', VEHICLE_TEXT_MAX);
  text('model', VEHICLE_TEXT_MAX);
  const year = parseWholeNumber(draft.year);
  if (year === null || year < VEHICLE_YEAR_MIN || year > maxVehicleYear(now)) {
    errors.year = 'onboarding.validation.year';
  }
  text('color', VEHICLE_COLOR_MAX);
  text('plate', VEHICLE_PLATE_MAX);
  const seats = parseWholeNumber(draft.seats);
  if (seats === null || seats < VEHICLE_SEATS_MIN || seats > VEHICLE_SEATS_MAX) {
    errors.seats = 'onboarding.validation.seats';
  }
  return errors;
}

export function validateVehiclePhotos(draft: VehicleDraft): string | null {
  if (draft.photos.length < VEHICLE_PHOTOS_MIN) return 'onboarding.validation.photosRequired';
  if (draft.photos.length > VEHICLE_PHOTOS_MAX) return 'onboarding.validation.photosTooMany';
  return null;
}

export function hasErrors(errors: object): boolean {
  return Object.keys(errors).length > 0;
}

/** Draft → contract DocumentInput (call only after validateDocument passed). */
export function toDocumentInput(draft: DocumentDraft): DocumentInput {
  return {
    type: draft.type,
    number: draft.number.trim(),
    expiresOn: draft.expiresOn as string,
    fileId: (draft.file as PickedFile).fileId,
  };
}

/** Draft → contract VehicleInput (call only after validation passed). */
export function toVehicleInput(draft: VehicleDraft): VehicleInput {
  return {
    make: draft.make.trim(),
    model: draft.model.trim(),
    year: parseWholeNumber(draft.year) as number,
    color: draft.color.trim(),
    plate: draft.plate.trim(),
    seats: parseWholeNumber(draft.seats) as number,
    photoFileIds: draft.photos.map((photo) => photo.fileId),
  };
}
