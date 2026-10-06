package com.labby.backend.service;

import com.labby.backend.dto.DocumentDto;
import com.labby.backend.dto.DocumentRenewalDto;
import com.labby.backend.dto.DocumentRenewalRequestDto;
import com.labby.backend.dto.DocumentSlotDto;
import com.labby.backend.dto.ExpiryDashboardDto;
import com.labby.backend.dto.ExpiryRowDto;
import com.labby.backend.dto.ReasonRequestDto;
import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.enums.DocumentType;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.ReviewStatus;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.DriverDocument;
import com.labby.backend.model.Vehicle;
import com.labby.backend.repository.DriverDocumentRepository;
import com.labby.backend.repository.DriverProfileRepository;
import com.labby.backend.repository.VehicleRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Document slots, renewals and the expiry dashboard (see {@link DriverDocumentService}). Renewal
 * approval flushes the replaced (approved) row to {@code superseded} FIRST — that frees the slot's
 * one-approved index for the renewal and its {@code @Version} serializes concurrent reviewers.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class DriverDocumentServiceImpl implements DriverDocumentService {

  private static final String TARGET_TYPE = "document";
  private static final int MAX_HORIZON_DAYS = 30;

  private final DriverDocumentRepository driverDocumentRepository;
  private final DriverProfileRepository driverProfileRepository;
  private final VehicleRepository vehicleRepository;
  private final OnboardingValidator validator;
  private final OnboardingAssembler assembler;
  private final DriverRoleService driverRoleService;
  private final NotificationService notificationService;
  private final AuditService auditService;
  private final OperatingCalendar calendar;

  @Override
  @Transactional(readOnly = true)
  public List<DocumentSlotDto> listSlots(UUID userId) {
    requireApprovedDriver(userId);
    LocalDate today = calendar.today();
    UUID activeVehicleId = activeVehicleId(userId);
    List<DriverDocument> documents =
        driverDocumentRepository.findByDriverUserIdOrderByCreatedAtAsc(userId);
    List<DocumentSlotDto> slots = new ArrayList<>();
    for (DocumentType type : DocumentType.values()) {
      UUID slotVehicle = DocumentSlots.slotVehicle(type, activeVehicleId);
      if (DocumentSlots.isVehicleBound(type) && slotVehicle == null) {
        continue;
      }
      Optional<DriverDocument> current = DocumentSlots.approved(documents, type, slotVehicle);
      if (current.isEmpty()) {
        continue;
      }
      DriverDocument renewal =
          DocumentSlots.open(documents, type, slotVehicle)
              .orElseGet(() -> latestRejectedAfter(documents, current.get()));
      slots.add(
          new DocumentSlotDto(
              type,
              slotVehicle,
              assembler.document(current.get()),
              current.get().getExpiresOn().isBefore(today),
              renewal == null ? null : assembler.document(renewal)));
    }
    return slots;
  }

  @Override
  public DocumentDto submitRenewal(UUID userId, String type, DocumentRenewalRequestDto request) {
    DocumentType documentType = parseType(type);
    requireApprovedDriver(userId);
    Map<String, String> errors = new LinkedHashMap<>();
    validator.validateDocumentFields(
        errors, "", request.number(), request.expiresOn(), request.fileId(), userId);
    OnboardingValidator.throwIfAny(errors);

    UUID slotVehicle = DocumentSlots.slotVehicle(documentType, activeVehicleId(userId));
    if (DocumentSlots.isVehicleBound(documentType) && slotVehicle == null) {
      throw new ConflictException("There is no active vehicle to renew this document for");
    }
    List<DriverDocument> documents =
        driverDocumentRepository.findByDriverUserIdOrderByCreatedAtAsc(userId);
    if (DocumentSlots.approved(documents, documentType, slotVehicle).isEmpty()) {
      throw new ConflictException("There is no current document of this type to renew");
    }
    String pending = "A renewal of this document is already pending";
    if (DocumentSlots.open(documents, documentType, slotVehicle).isPresent()) {
      throw new ConflictException(pending);
    }
    DriverDocument renewal =
        OnboardingPersistence.saveAndFlush(
            driverDocumentRepository,
            DriverDocument.builder()
                .driverUserId(userId)
                .vehicleId(slotVehicle)
                .type(documentType)
                .number(request.number().strip())
                .expiresOn(request.expiresOn())
                .storedFileId(request.fileId())
                .build(),
            pending);
    notificationService.queue(userId, NotificationEvent.DOCUMENT_RENEWAL_SUBMITTED);
    return assembler.document(renewal);
  }

  @Override
  @Transactional(readOnly = true)
  public List<DocumentRenewalDto> listRenewals() {
    return driverDocumentRepository
        .findPendingRenewals(
            ReviewStatus.PENDING, ReviewStatus.APPROVED, ApplicationStatus.APPROVED)
        .stream()
        .map(renewal -> toRenewalDto(renewal, currentFor(renewal).orElseThrow()))
        .toList();
  }

  @Override
  @Transactional(readOnly = true)
  public DocumentRenewalDto getRenewal(UUID documentId) {
    DriverDocument renewal = requireDocument(documentId);
    if (renewal.getReviewStatus() != ReviewStatus.PENDING) {
      throw notARenewal(documentId);
    }
    return toRenewalDto(renewal, requireCurrent(renewal));
  }

  @Override
  public DocumentRenewalDto approveRenewal(UUID actorUserId, UUID documentId) {
    DriverDocument renewal = requirePendingRenewal(documentId);
    DriverDocument current = requireCurrent(renewal);
    if (renewal.getExpiresOn().isBefore(calendar.today())) {
      throw new ConflictException("The renewal has itself expired; reject it");
    }

    Instant now = calendar.now();
    current.setReviewStatus(ReviewStatus.SUPERSEDED);
    current = driverDocumentRepository.saveAndFlush(current);
    renewal.setReviewStatus(ReviewStatus.APPROVED);
    renewal.setReviewNote(null);
    renewal.setReviewedBy(actorUserId);
    renewal.setReviewedAt(now);
    renewal = driverDocumentRepository.saveAndFlush(renewal);
    driverRoleService.reinstateIfNoExpiredDocument(renewal.getDriverUserId());

    notificationService.queue(
        renewal.getDriverUserId(), NotificationEvent.DOCUMENT_RENEWAL_APPROVED);
    Map<String, Object> before = new LinkedHashMap<>();
    before.put("currentDocumentId", current.getId().toString());
    before.put("expiresOn", current.getExpiresOn().toString());
    Map<String, Object> after = new LinkedHashMap<>();
    after.put("currentDocumentId", renewal.getId().toString());
    after.put("expiresOn", renewal.getExpiresOn().toString());
    auditService.record(
        actorUserId, "document.approve", TARGET_TYPE, renewal.getId().toString(), before, after);
    return toRenewalDto(renewal, current);
  }

  @Override
  public DocumentRenewalDto rejectRenewal(
      UUID actorUserId, UUID documentId, ReasonRequestDto request) {
    DriverDocument renewal = requirePendingRenewal(documentId);
    DriverDocument current = requireCurrent(renewal);
    String reason = request.reason().strip();
    renewal.setReviewStatus(ReviewStatus.REJECTED);
    renewal.setReviewNote(reason);
    renewal.setReviewedBy(actorUserId);
    renewal.setReviewedAt(calendar.now());
    renewal = driverDocumentRepository.saveAndFlush(renewal);

    notificationService.queue(
        renewal.getDriverUserId(), NotificationEvent.DOCUMENT_RENEWAL_REJECTED);
    auditService.record(
        actorUserId,
        "document.reject",
        TARGET_TYPE,
        renewal.getId().toString(),
        Map.of("reviewStatus", ReviewStatus.PENDING.getValue()),
        Map.of("reviewStatus", ReviewStatus.REJECTED.getValue(), "reason", reason));
    return toRenewalDto(renewal, current);
  }

  @Override
  @Transactional(readOnly = true)
  public ExpiryDashboardDto expiryDashboard(int horizonDays) {
    if (horizonDays < 1 || horizonDays > MAX_HORIZON_DAYS) {
      throw new InvalidRequestException("horizonDays must be between 1 and 30");
    }
    LocalDate today = calendar.today();
    List<ExpiryRowDto> upcoming = new ArrayList<>();
    List<ExpiryRowDto> expired = new ArrayList<>();
    for (DriverDocument document :
        driverDocumentRepository.findCurrentExpiringOnOrBefore(
            ReviewStatus.APPROVED, ApplicationStatus.APPROVED, today.plusDays(horizonDays))) {
      long daysLeft = ChronoUnit.DAYS.between(today, document.getExpiresOn());
      List<DriverDocument> driverDocuments =
          driverDocumentRepository.findByDriverUserIdOrderByCreatedAtAsc(
              document.getDriverUserId());
      ExpiryRowDto row =
          new ExpiryRowDto(
              assembler.document(document),
              assembler.applicant(document.getDriverUserId()),
              daysLeft,
              driverRoleService.isSuspended(document.getDriverUserId()),
              DocumentSlots.open(driverDocuments, document.getType(), document.getVehicleId())
                  .isPresent(),
              document.getReminder30SentAt(),
              document.getReminder7SentAt());
      (daysLeft < 0 ? expired : upcoming).add(row);
    }
    return new ExpiryDashboardDto(horizonDays, upcoming, expired);
  }

  private DocumentRenewalDto toRenewalDto(DriverDocument renewal, DriverDocument current) {
    return new DocumentRenewalDto(
        assembler.applicant(renewal.getDriverUserId()),
        assembler.document(renewal),
        assembler.document(current),
        driverRoleService.isSuspendedForExpiry(renewal.getDriverUserId()));
  }

  /** The approved row of the renewal's slot. */
  private Optional<DriverDocument> currentFor(DriverDocument renewal) {
    return DocumentSlots.approved(
        driverDocumentRepository.findByDriverUserIdOrderByCreatedAtAsc(renewal.getDriverUserId()),
        renewal.getType(),
        renewal.getVehicleId());
  }

  /** The current row of a renewal of an approved driver; anything else is not a renewal (404). */
  private DriverDocument requireCurrent(DriverDocument renewal) {
    if (!isApprovedDriver(renewal.getDriverUserId())) {
      throw notARenewal(renewal.getId());
    }
    return currentFor(renewal).orElseThrow(() -> notARenewal(renewal.getId()));
  }

  /**
   * A pending renewal, locked for the decision; a decided one is 409 (the other decision won). The
   * row lock makes a concurrent decision wait for the winner's commit and then see it decided.
   */
  private DriverDocument requirePendingRenewal(UUID documentId) {
    DriverDocument renewal =
        driverDocumentRepository
            .findForUpdate(documentId)
            .orElseThrow(() -> notARenewal(documentId));
    if (renewal.getReviewStatus() == ReviewStatus.PENDING) {
      return renewal;
    }
    if (renewal.getReviewStatus() == ReviewStatus.APPROVED
        || renewal.getReviewStatus() == ReviewStatus.REJECTED) {
      throw new ConflictException("The renewal has already been decided");
    }
    throw notARenewal(documentId);
  }

  private DriverDocument requireDocument(UUID documentId) {
    return driverDocumentRepository.findById(documentId).orElseThrow(() -> notARenewal(documentId));
  }

  /** The newest rejected row of the current document's slot submitted after it (a renewal). */
  private static DriverDocument latestRejectedAfter(
      List<DriverDocument> documents, DriverDocument current) {
    DriverDocument latest = null;
    for (DriverDocument document : documents) {
      if (DocumentSlots.inSlot(document, current.getType(), current.getVehicleId())
          && document.getReviewStatus() == ReviewStatus.REJECTED
          && document.getCreatedAt().isAfter(current.getCreatedAt())) {
        latest = document;
      }
    }
    return latest;
  }

  private void requireApprovedDriver(UUID userId) {
    if (!isApprovedDriver(userId)) {
      throw new ConflictException("Only approved drivers have document slots");
    }
  }

  private boolean isApprovedDriver(UUID userId) {
    return driverProfileRepository
        .findByUserId(userId)
        .filter(profile -> profile.getApplicationStatus() == ApplicationStatus.APPROVED)
        .isPresent();
  }

  private UUID activeVehicleId(UUID userId) {
    return vehicleRepository
        .findByDriverUserIdAndActiveTrue(userId)
        .map(Vehicle::getId)
        .orElse(null);
  }

  private static DocumentType parseType(String type) {
    try {
      return DocumentType.fromValue(type);
    } catch (IllegalArgumentException ex) {
      throw new InvalidRequestException("Unknown document type: " + type);
    }
  }

  private static ResourceNotFoundException notARenewal(UUID documentId) {
    return new ResourceNotFoundException("Document renewal", documentId);
  }
}
