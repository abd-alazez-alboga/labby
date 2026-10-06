package com.labby.backend.service;

import com.labby.backend.dto.ApproveRequestDto;
import com.labby.backend.dto.DocumentInputDto;
import com.labby.backend.dto.ReasonRequestDto;
import com.labby.backend.dto.VehicleDto;
import com.labby.backend.dto.VehicleInputDto;
import com.labby.backend.dto.VehicleReviewDto;
import com.labby.backend.dto.VehicleReviewSummaryDto;
import com.labby.backend.dto.VehicleSwitchRequestDto;
import com.labby.backend.dto.VehicleWithDocumentsDto;
import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.enums.DocumentType;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.ReviewStatus;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.DriverDocument;
import com.labby.backend.model.Vehicle;
import com.labby.backend.repository.DriverDocumentRepository;
import com.labby.backend.repository.DriverProfileRepository;
import com.labby.backend.repository.VehicleRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Vehicle switch flow (see {@link DriverVehicleService}). On approval the old vehicle is
 * deactivated and flushed BEFORE the new one is activated: the one-active-per-driver partial unique
 * index is checked per statement. The switch vehicle's own row is flushed first so its
 * {@code @Version} serializes concurrent reviewers (loser → 409).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class DriverVehicleServiceImpl implements DriverVehicleService {

  private static final String TARGET_TYPE = "vehicle";
  private static final Set<DocumentType> VEHICLE_DOCUMENTS =
      EnumSet.of(DocumentType.VEHICLE_REGISTRATION, DocumentType.INSURANCE);
  private static final Set<ReviewStatus> OPEN =
      EnumSet.of(ReviewStatus.PENDING, ReviewStatus.CHANGES_REQUESTED);
  private static final String SWITCH_OPEN = "A vehicle switch is already under review";

  private final VehicleRepository vehicleRepository;
  private final DriverDocumentRepository driverDocumentRepository;
  private final DriverProfileRepository driverProfileRepository;
  private final OnboardingValidator validator;
  private final OnboardingAssembler assembler;
  private final DriverRoleService driverRoleService;
  private final NotificationService notificationService;
  private final AuditService auditService;
  private final OperatingCalendar calendar;

  @Override
  @Transactional(readOnly = true)
  public List<VehicleWithDocumentsDto> listOwnVehicles(UUID userId) {
    List<DriverDocument> documents =
        driverDocumentRepository.findByDriverUserIdOrderByCreatedAtAsc(userId);
    return vehicleRepository.findByDriverUserIdOrderByCreatedAtDesc(userId).stream()
        .map(vehicle -> assembler.vehicleWithDocuments(vehicle, documents))
        .toList();
  }

  @Override
  public VehicleWithDocumentsDto submitSwitch(UUID userId, VehicleSwitchRequestDto request) {
    if (!isApprovedDriver(userId)) {
      throw new ConflictException("Only approved drivers can switch vehicles");
    }
    if (vehicleRepository.existsByDriverUserIdAndReviewStatusIn(userId, OPEN)) {
      throw new ConflictException(SWITCH_OPEN);
    }
    Map<String, String> errors = new LinkedHashMap<>();
    validator.validateVehicle(errors, request.vehicle(), userId);
    Map<DocumentType, DocumentInputDto> documents =
        validator.validateDocuments(
            errors,
            request.documents(),
            VEHICLE_DOCUMENTS,
            userId,
            "is required",
            "is not part of a vehicle switch");
    OnboardingValidator.throwIfAny(errors);

    VehicleInputDto input = request.vehicle();
    Vehicle vehicle =
        OnboardingPersistence.saveAndFlush(
            vehicleRepository,
            Vehicle.builder()
                .driverUserId(userId)
                .make(input.make().strip())
                .model(input.model().strip())
                .year(input.year().shortValue())
                .color(input.color().strip())
                .plate(OnboardingValidator.normalizePlate(input.plate()))
                .seats(input.seats().shortValue())
                .photoFileIds(new ArrayList<>(input.photoFileIds()))
                .build(),
            SWITCH_OPEN);
    for (DocumentInputDto document : documents.values()) {
      OnboardingPersistence.saveAndFlush(
          driverDocumentRepository,
          DriverDocument.builder()
              .driverUserId(userId)
              .vehicleId(vehicle.getId())
              .type(document.type())
              .number(document.number().strip())
              .expiresOn(document.expiresOn())
              .storedFileId(document.fileId())
              .build(),
          SWITCH_OPEN);
    }
    notificationService.queue(userId, NotificationEvent.VEHICLE_SWITCH_SUBMITTED);
    return assembler.vehicleWithDocuments(
        vehicle, driverDocumentRepository.findByDriverUserIdOrderByCreatedAtAsc(userId));
  }

  @Override
  @Transactional(readOnly = true)
  public List<VehicleReviewSummaryDto> listSwitchQueue() {
    return vehicleRepository
        .findSwitchCandidates(ReviewStatus.PENDING, ApplicationStatus.APPROVED)
        .stream()
        .map(
            vehicle ->
                new VehicleReviewSummaryDto(
                    vehicle.getId(),
                    assembler.applicant(vehicle.getDriverUserId()),
                    vehicle.getMake(),
                    vehicle.getModel(),
                    vehicle.getPlate(),
                    vehicle.getCreatedAt(),
                    isDuplicatePlate(vehicle)))
        .toList();
  }

  @Override
  @Transactional(readOnly = true)
  public VehicleReviewDto getSwitch(UUID vehicleId) {
    Vehicle vehicle = requireSwitchVehicle(vehicleId);
    if (vehicle.getReviewStatus() != ReviewStatus.PENDING) {
      throw notASwitch(vehicleId);
    }
    return toReviewDto(vehicle);
  }

  @Override
  public VehicleReviewDto approveSwitch(
      UUID actorUserId, UUID vehicleId, ApproveRequestDto request) {
    Set<UUID> serviceTypeIds = validator.requireAssignableServiceTypes(request.serviceTypeIds());
    Vehicle vehicle = requirePendingSwitch(vehicleId);
    if (isDuplicatePlate(vehicle)) {
      throw new ConflictException("The plate is on another driver's active vehicle");
    }
    List<DriverDocument> documents = switchDocuments(vehicle);
    LocalDate today = calendar.today();
    for (DriverDocument document : documents) {
      if (document.getExpiresOn().isBefore(today)) {
        throw new ConflictException(
            "The %s has expired; reject the switch".formatted(document.getType().getValue()));
      }
    }

    Instant now = calendar.now();
    vehicle.setReviewStatus(ReviewStatus.APPROVED);
    vehicle.setReviewNote(null);
    vehicle.setReviewedBy(actorUserId);
    vehicle.setReviewedAt(now);
    vehicle.setServiceTypeIds(new HashSet<>(serviceTypeIds));
    vehicle = vehicleRepository.saveAndFlush(vehicle);

    Optional<Vehicle> previous =
        vehicleRepository.findByDriverUserIdAndActiveTrue(vehicle.getDriverUserId());
    previous.ifPresent(
        old -> {
          old.setActive(false);
          vehicleRepository.saveAndFlush(old);
        });
    vehicle.setActive(true);
    vehicle = vehicleRepository.saveAndFlush(vehicle);
    for (DriverDocument document : documents) {
      document.setReviewStatus(ReviewStatus.APPROVED);
      document.setReviewedBy(actorUserId);
      document.setReviewedAt(now);
      driverDocumentRepository.saveAndFlush(document);
    }
    // The active vehicle's documents are now the switch's: an expiry suspension caused by the old
    // vehicle's papers no longer applies once nothing current is expired.
    driverRoleService.reinstateIfNoExpiredDocument(vehicle.getDriverUserId());

    notificationService.queue(vehicle.getDriverUserId(), NotificationEvent.VEHICLE_SWITCH_APPROVED);
    Map<String, Object> before = new LinkedHashMap<>();
    before.put("reviewStatus", ReviewStatus.PENDING.getValue());
    before.put("activeVehicleId", previous.map(old -> old.getId().toString()).orElse(null));
    Map<String, Object> after = new LinkedHashMap<>();
    after.put("reviewStatus", ReviewStatus.APPROVED.getValue());
    after.put("activeVehicleId", vehicle.getId().toString());
    after.put("serviceTypeIds", serviceTypeIds.stream().map(UUID::toString).toList());
    auditService.record(
        actorUserId, "vehicle.approve", TARGET_TYPE, vehicle.getId().toString(), before, after);
    return toReviewDto(vehicle);
  }

  @Override
  public VehicleReviewDto rejectSwitch(UUID actorUserId, UUID vehicleId, ReasonRequestDto request) {
    Vehicle vehicle = requirePendingSwitch(vehicleId);
    String reason = request.reason().strip();
    Instant now = calendar.now();
    vehicle.setReviewStatus(ReviewStatus.REJECTED);
    vehicle.setReviewNote(reason);
    vehicle.setReviewedBy(actorUserId);
    vehicle.setReviewedAt(now);
    vehicle = vehicleRepository.saveAndFlush(vehicle);
    for (DriverDocument document : switchDocuments(vehicle)) {
      document.setReviewStatus(ReviewStatus.REJECTED);
      document.setReviewNote(reason);
      document.setReviewedBy(actorUserId);
      document.setReviewedAt(now);
      driverDocumentRepository.saveAndFlush(document);
    }

    notificationService.queue(vehicle.getDriverUserId(), NotificationEvent.VEHICLE_SWITCH_REJECTED);
    auditService.record(
        actorUserId,
        "vehicle.reject",
        TARGET_TYPE,
        vehicle.getId().toString(),
        Map.of("reviewStatus", ReviewStatus.PENDING.getValue()),
        Map.of("reviewStatus", ReviewStatus.REJECTED.getValue(), "reason", reason));
    return toReviewDto(vehicle);
  }

  /** A vehicle of an approved driver (a switch candidate or a decided switch), else 404. */
  private Vehicle requireSwitchVehicle(UUID vehicleId) {
    Vehicle vehicle =
        vehicleRepository.findById(vehicleId).orElseThrow(() -> notASwitch(vehicleId));
    if (!isApprovedDriver(vehicle.getDriverUserId())) {
      throw notASwitch(vehicleId);
    }
    return vehicle;
  }

  /** A switch that is still pending; a decided one is 409 (the other decision won). */
  private Vehicle requirePendingSwitch(UUID vehicleId) {
    Vehicle vehicle = requireSwitchVehicle(vehicleId);
    if (vehicle.getReviewStatus() != ReviewStatus.PENDING) {
      throw new ConflictException("The vehicle switch is not pending");
    }
    return vehicle;
  }

  /** The switch vehicle's open registration + insurance rows. */
  private List<DriverDocument> switchDocuments(Vehicle vehicle) {
    return driverDocumentRepository
        .findByDriverUserIdOrderByCreatedAtAsc(vehicle.getDriverUserId())
        .stream()
        .filter(document -> vehicle.getId().equals(document.getVehicleId()))
        .filter(document -> OPEN.contains(document.getReviewStatus()))
        .toList();
  }

  private VehicleReviewDto toReviewDto(Vehicle vehicle) {
    List<DriverDocument> documents =
        driverDocumentRepository.findByDriverUserIdOrderByCreatedAtAsc(vehicle.getDriverUserId());
    VehicleDto current =
        vehicleRepository
            .findByDriverUserIdAndActiveTrue(vehicle.getDriverUserId())
            .filter(active -> !active.getId().equals(vehicle.getId()))
            .map(assembler::vehicle)
            .orElse(null);
    return new VehicleReviewDto(
        assembler.applicant(vehicle.getDriverUserId()),
        assembler.vehicleWithDocuments(vehicle, documents),
        current,
        isDuplicatePlate(vehicle));
  }

  private boolean isApprovedDriver(UUID userId) {
    return driverProfileRepository
        .findByUserId(userId)
        .filter(profile -> profile.getApplicationStatus() == ApplicationStatus.APPROVED)
        .isPresent();
  }

  private boolean isDuplicatePlate(Vehicle vehicle) {
    return vehicleRepository.existsByPlateAndActiveTrueAndDriverUserIdNot(
        vehicle.getPlate(), vehicle.getDriverUserId());
  }

  private static ResourceNotFoundException notASwitch(UUID vehicleId) {
    return new ResourceNotFoundException("Vehicle switch", vehicleId);
  }
}
