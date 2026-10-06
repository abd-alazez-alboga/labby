package com.labby.backend.service;

import com.labby.backend.enums.DocumentType;
import com.labby.backend.enums.ReviewStatus;
import com.labby.backend.model.DriverDocument;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Slot arithmetic over a driver's document rows (V6): a slot is (driver, type, vehicle) — ID and
 * licence carry no vehicle, registration and insurance belong to one. A slot holds at most one
 * approved (current) row and one open row (a renewal or an application/switch document in review);
 * superseded and rejected rows are history. Every method expects the driver's rows oldest first.
 */
final class DocumentSlots {

  private DocumentSlots() {}

  /** Registration and insurance belong to a vehicle; ID and licence to the driver. */
  static boolean isVehicleBound(DocumentType type) {
    return type == DocumentType.VEHICLE_REGISTRATION || type == DocumentType.INSURANCE;
  }

  /** The vehicle a slot of this type is keyed by: the given vehicle when bound, else none. */
  static UUID slotVehicle(DocumentType type, UUID vehicleId) {
    return isVehicleBound(type) ? vehicleId : null;
  }

  static boolean inSlot(DriverDocument document, DocumentType type, UUID vehicleId) {
    return document.getType() == type
        && Objects.equals(document.getVehicleId(), slotVehicle(type, vehicleId));
  }

  /** The approved (current) row of the slot. */
  static Optional<DriverDocument> approved(
      List<DriverDocument> documents, DocumentType type, UUID vehicleId) {
    return documents.stream()
        .filter(document -> inSlot(document, type, vehicleId))
        .filter(document -> document.getReviewStatus() == ReviewStatus.APPROVED)
        .findFirst();
  }

  /** The open row of the slot (pending or changes requested). */
  static Optional<DriverDocument> open(
      List<DriverDocument> documents, DocumentType type, UUID vehicleId) {
    return documents.stream()
        .filter(document -> inSlot(document, type, vehicleId))
        .filter(
            document ->
                document.getReviewStatus() == ReviewStatus.PENDING
                    || document.getReviewStatus() == ReviewStatus.CHANGES_REQUESTED)
        .findFirst();
  }

  /** The newest row of the slot that has not been superseded. */
  static Optional<DriverDocument> latestNonSuperseded(
      List<DriverDocument> documents, DocumentType type, UUID vehicleId) {
    DriverDocument latest = null;
    for (DriverDocument document : documents) {
      if (inSlot(document, type, vehicleId)
          && document.getReviewStatus() != ReviewStatus.SUPERSEDED) {
        latest = document;
      }
    }
    return Optional.ofNullable(latest);
  }

  /** The approved row when there is one, else the newest non-superseded row. */
  static Optional<DriverDocument> currentOrLatest(
      List<DriverDocument> documents, DocumentType type, UUID vehicleId) {
    return approved(documents, type, vehicleId)
        .or(() -> latestNonSuperseded(documents, type, vehicleId));
  }
}
