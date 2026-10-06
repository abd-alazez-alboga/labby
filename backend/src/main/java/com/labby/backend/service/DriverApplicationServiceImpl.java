package com.labby.backend.service;

import com.labby.backend.dto.AdminDriverApplicationDto;
import com.labby.backend.dto.ApplicationEventDto;
import com.labby.backend.dto.ApplicationResubmitRequestDto;
import com.labby.backend.dto.ApplicationSubmitRequestDto;
import com.labby.backend.dto.ApplicationSummaryDto;
import com.labby.backend.dto.ApplicationSummaryPageDto;
import com.labby.backend.dto.ApproveRequestDto;
import com.labby.backend.dto.DocumentInputDto;
import com.labby.backend.dto.DriverApplicationDto;
import com.labby.backend.dto.PersonalItemDto;
import com.labby.backend.dto.ReasonRequestDto;
import com.labby.backend.dto.RequestChangesItemDto;
import com.labby.backend.dto.RequestChangesRequestDto;
import com.labby.backend.dto.ServiceTypeRefDto;
import com.labby.backend.dto.VehicleInputDto;
import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.enums.DocumentType;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.RegionState;
import com.labby.backend.enums.ReviewItem;
import com.labby.backend.enums.ReviewStatus;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.FieldValidationException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.exception.UnauthorizedException;
import com.labby.backend.model.DriverApplicationEvent;
import com.labby.backend.model.DriverDocument;
import com.labby.backend.model.DriverProfile;
import com.labby.backend.model.Region;
import com.labby.backend.model.User;
import com.labby.backend.model.Vehicle;
import com.labby.backend.repository.DriverApplicationEventRepository;
import com.labby.backend.repository.DriverDocumentRepository;
import com.labby.backend.repository.DriverProfileRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.repository.VehicleRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Driver application lifecycle (see {@link DriverApplicationService}). The application's items are
 * the personal details (account name + photo, reviewed on the profile row), the four documents and
 * the vehicle. Flagged vehicles are corrected in place; flagged documents are versioned (the
 * flagged row becomes {@code superseded}, the correction is a new pending row). Decisions flush the
 * profile row FIRST so its {@code @Version} serializes concurrent reviewers (loser → 409).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class DriverApplicationServiceImpl implements DriverApplicationService {

  static final String TARGET_TYPE = "driver_application";
  private static final Set<ApplicationStatus> DEFAULT_QUEUE =
      EnumSet.of(ApplicationStatus.SUBMITTED, ApplicationStatus.UNDER_REVIEW);
  private static final Set<ReviewStatus> OPEN =
      EnumSet.of(ReviewStatus.PENDING, ReviewStatus.CHANGES_REQUESTED);
  private static final String CONCURRENT_SUBMISSION = "An application is already open or approved";

  private final DriverProfileRepository driverProfileRepository;
  private final DriverApplicationEventRepository driverApplicationEventRepository;
  private final VehicleRepository vehicleRepository;
  private final DriverDocumentRepository driverDocumentRepository;
  private final UserRepository userRepository;
  private final ServiceTypeRepository serviceTypeRepository;
  private final RegionRepository regionRepository;
  private final OnboardingValidator validator;
  private final OnboardingAssembler assembler;
  private final DriverRoleService driverRoleService;
  private final NotificationService notificationService;
  private final AuditService auditService;
  private final OperatingCalendar calendar;

  @Override
  @Transactional(readOnly = true)
  public DriverApplicationDto getOwnApplication(UUID userId) {
    DriverProfile profile = requireOwnProfile(userId);
    return toApplicationDto(profile, requireUser(userId));
  }

  @Override
  public DriverApplicationDto submit(UUID userId, ApplicationSubmitRequestDto request) {
    User user = requireUser(userId);
    DriverProfile existing = driverProfileRepository.findByUserId(userId).orElse(null);
    ApplicationStatus from = existing == null ? null : existing.getApplicationStatus();
    if (!ApplicationStateMachine.canTransition(from, ApplicationStatus.SUBMITTED)) {
      throw new ConflictException(CONCURRENT_SUBMISSION);
    }

    Map<String, String> errors = new LinkedHashMap<>();
    if (user.getPhotoPath() == null) {
      errors.put("profilePhoto", "A profile photo is required to apply");
    }
    Map<DocumentType, DocumentInputDto> documents =
        validator.validateDocuments(
            errors,
            request.documents(),
            EnumSet.allOf(DocumentType.class),
            userId,
            "is required",
            "is not expected here");
    validator.validateVehicle(errors, request.vehicle(), userId);
    OnboardingValidator.throwIfAny(errors);

    DriverProfile profile =
        existing != null ? existing : DriverProfile.builder().userId(userId).build();
    profile.setApplicationStatus(ApplicationStatus.SUBMITTED);
    profile.setSubmittedAt(calendar.now());
    profile.setDecidedAt(null);
    profile.setDecidedBy(null);
    profile.setRejectionReason(null);
    profile.setPersonalReviewStatus(ReviewStatus.PENDING);
    profile.setPersonalReviewNote(null);
    profile =
        OnboardingPersistence.saveAndFlush(driverProfileRepository, profile, CONCURRENT_SUBMISSION);

    Vehicle vehicle = Vehicle.builder().driverUserId(userId).build();
    applyVehicleInput(vehicle, request.vehicle());
    vehicle = OnboardingPersistence.saveAndFlush(vehicleRepository, vehicle, CONCURRENT_SUBMISSION);
    for (DocumentInputDto document : documents.values()) {
      OnboardingPersistence.saveAndFlush(
          driverDocumentRepository,
          newDocument(userId, document, vehicle.getId()),
          CONCURRENT_SUBMISSION);
    }

    recordEvent(profile, from, ApplicationStatus.SUBMITTED, null, userId);
    notificationService.queue(userId, NotificationEvent.DRIVER_APPLICATION_SUBMITTED);
    return toApplicationDto(profile, user);
  }

  @Override
  public DriverApplicationDto resubmit(UUID userId, ApplicationResubmitRequestDto request) {
    DriverProfile profile = requireOwnProfile(userId);
    User user = requireUser(userId);
    ApplicationStatus from = profile.getApplicationStatus();
    if (from != ApplicationStatus.NEEDS_CHANGES) {
      throw new ConflictException("Only an application that needs changes can be resubmitted");
    }
    Vehicle vehicle = applicationVehicle(profile);
    Map<DocumentType, DriverDocument> current = applicationDocuments(profile, vehicle);
    Set<DocumentType> flaggedDocuments = EnumSet.noneOf(DocumentType.class);
    current.forEach(
        (type, document) -> {
          if (document.getReviewStatus() == ReviewStatus.CHANGES_REQUESTED) {
            flaggedDocuments.add(type);
          }
        });
    boolean vehicleFlagged = vehicle.getReviewStatus() == ReviewStatus.CHANGES_REQUESTED;
    boolean personalFlagged = profile.getPersonalReviewStatus() == ReviewStatus.CHANGES_REQUESTED;

    Map<String, String> errors = new LinkedHashMap<>();
    boolean confirmed = Boolean.TRUE.equals(request.confirmPersonalDetails());
    if (personalFlagged && !confirmed) {
      errors.put("confirmPersonalDetails", "The personal details are flagged; confirm them");
    } else if (!personalFlagged && confirmed) {
      errors.put("confirmPersonalDetails", "The personal details were not flagged for changes");
    }
    if (personalFlagged && user.getPhotoPath() == null) {
      errors.put("profilePhoto", "A profile photo is required to apply");
    }
    Map<DocumentType, DocumentInputDto> documents =
        validator.validateDocuments(
            errors,
            request.documents(),
            flaggedDocuments,
            userId,
            "is flagged and must be resubmitted",
            "was not flagged for changes");
    VehicleInputDto vehicleInput = request.vehicle();
    if (vehicleFlagged) {
      validator.validateVehicle(errors, vehicleInput, userId);
    } else if (vehicleInput != null) {
      errors.put("vehicle", "was not flagged for changes");
    }
    OnboardingValidator.throwIfAny(errors);

    // Flush the profile first: its version serializes a resubmission against anything else.
    profile.setApplicationStatus(ApplicationStatus.UNDER_REVIEW);
    if (personalFlagged) {
      profile.setPersonalReviewStatus(ReviewStatus.PENDING);
      profile.setPersonalReviewNote(null);
    }
    profile = driverProfileRepository.saveAndFlush(profile);
    if (vehicleFlagged) {
      applyVehicleInput(vehicle, vehicleInput);
      vehicle.setReviewNote(null);
      vehicleRepository.saveAndFlush(vehicle);
    }
    for (DocumentType type : flaggedDocuments) {
      DriverDocument flagged = current.get(type);
      flagged.setReviewStatus(ReviewStatus.SUPERSEDED);
      driverDocumentRepository.saveAndFlush(flagged);
      OnboardingPersistence.saveAndFlush(
          driverDocumentRepository,
          newDocument(userId, documents.get(type), vehicle.getId()),
          "This document was already resubmitted");
    }

    recordEvent(profile, from, ApplicationStatus.UNDER_REVIEW, null, userId);
    notificationService.queue(userId, NotificationEvent.DRIVER_APPLICATION_UNDER_REVIEW);
    return toApplicationDto(profile, user);
  }

  @Override
  @Transactional(readOnly = true)
  public ApplicationSummaryPageDto listApplications(List<String> statuses, int page, int size) {
    Set<ApplicationStatus> filter = parseStatuses(statuses);
    Page<DriverProfile> result =
        driverProfileRepository.findByApplicationStatusIn(
            filter,
            PageRequest.of(
                page,
                size,
                Sort.by(Sort.Direction.ASC, "submittedAt").and(Sort.by(Sort.Direction.ASC, "id"))));
    List<ApplicationSummaryDto> items =
        result.getContent().stream()
            .map(
                profile -> {
                  Vehicle vehicle = applicationVehicle(profile);
                  return new ApplicationSummaryDto(
                      profile.getId(),
                      assembler.applicant(profile.getUserId()),
                      profile.getApplicationStatus(),
                      profile.getSubmittedAt(),
                      vehicle.getPlate(),
                      isDuplicatePlate(vehicle));
                })
            .toList();
    return new ApplicationSummaryPageDto(items, page, size, result.getTotalElements());
  }

  @Override
  @Transactional(readOnly = true)
  public AdminDriverApplicationDto getApplication(UUID applicationId) {
    return toAdminDto(requireProfile(applicationId));
  }

  @Override
  public AdminDriverApplicationDto startReview(UUID actorUserId, UUID applicationId) {
    DriverProfile profile = requireProfile(applicationId);
    ApplicationStatus from = profile.getApplicationStatus();
    // under_review is also reachable from needs_changes, but only by the applicant's resubmission.
    if (from != ApplicationStatus.SUBMITTED) {
      throw new ConflictException("Only a submitted application can be taken into review");
    }
    profile.setApplicationStatus(ApplicationStatus.UNDER_REVIEW);
    profile = driverProfileRepository.saveAndFlush(profile);

    recordEvent(profile, from, ApplicationStatus.UNDER_REVIEW, null, actorUserId);
    notificationService.queue(
        profile.getUserId(), NotificationEvent.DRIVER_APPLICATION_UNDER_REVIEW);
    auditService.record(
        actorUserId,
        "driver_application.start_review",
        TARGET_TYPE,
        profile.getId().toString(),
        Map.of("status", from.getValue()),
        Map.of("status", ApplicationStatus.UNDER_REVIEW.getValue()));
    return toAdminDto(profile);
  }

  @Override
  public AdminDriverApplicationDto requestChanges(
      UUID actorUserId, UUID applicationId, RequestChangesRequestDto request) {
    validateChangeItems(request.items());
    DriverProfile profile = requireProfile(applicationId);
    ApplicationStatus from = profile.getApplicationStatus();
    ApplicationStateMachine.requireTransition(from, ApplicationStatus.NEEDS_CHANGES);

    Instant now = calendar.now();
    profile.setApplicationStatus(ApplicationStatus.NEEDS_CHANGES);
    profile = driverProfileRepository.saveAndFlush(profile);
    Vehicle vehicle = applicationVehicle(profile);
    Map<DocumentType, DriverDocument> documents = applicationDocuments(profile, vehicle);
    List<String> flagged = new ArrayList<>();
    for (RequestChangesItemDto item : request.items()) {
      String note = item.note().strip();
      switch (item.item()) {
        case PERSONAL -> {
          profile.setPersonalReviewStatus(ReviewStatus.CHANGES_REQUESTED);
          profile.setPersonalReviewNote(note);
          flagged.add(ReviewItem.PERSONAL.getValue());
        }
        case VEHICLE -> {
          vehicle.setReviewStatus(ReviewStatus.CHANGES_REQUESTED);
          vehicle.setReviewNote(note);
          vehicle.setReviewedBy(actorUserId);
          vehicle.setReviewedAt(now);
          vehicleRepository.save(vehicle);
          flagged.add(ReviewItem.VEHICLE.getValue());
        }
        case DOCUMENT -> {
          DriverDocument document = documents.get(item.documentType());
          document.setReviewStatus(ReviewStatus.CHANGES_REQUESTED);
          document.setReviewNote(note);
          document.setReviewedBy(actorUserId);
          document.setReviewedAt(now);
          driverDocumentRepository.save(document);
          flagged.add(OnboardingValidator.documentKey(item.documentType()));
        }
        default -> throw new IllegalStateException("Unknown review item " + item.item());
      }
    }
    driverProfileRepository.save(profile);

    String note = request.note() == null || request.note().isBlank() ? null : request.note();
    recordEvent(profile, from, ApplicationStatus.NEEDS_CHANGES, note, actorUserId);
    notificationService.queue(
        profile.getUserId(), NotificationEvent.DRIVER_APPLICATION_NEEDS_CHANGES);
    Map<String, Object> after = new LinkedHashMap<>();
    after.put("status", ApplicationStatus.NEEDS_CHANGES.getValue());
    after.put("items", flagged);
    after.put("note", note);
    auditService.record(
        actorUserId,
        "driver_application.request_changes",
        TARGET_TYPE,
        profile.getId().toString(),
        Map.of("status", from.getValue()),
        after);
    return toAdminDto(profile);
  }

  @Override
  public AdminDriverApplicationDto approve(
      UUID actorUserId, UUID applicationId, ApproveRequestDto request) {
    Set<UUID> serviceTypeIds = validator.requireAssignableServiceTypes(request.serviceTypeIds());
    DriverProfile profile = requireProfile(applicationId);
    ApplicationStatus from = profile.getApplicationStatus();
    ApplicationStateMachine.requireTransition(from, ApplicationStatus.APPROVED);
    Vehicle vehicle = applicationVehicle(profile);
    if (isDuplicatePlate(vehicle)) {
      throw new ConflictException(
          "The plate is on another driver's active vehicle; request changes or reject");
    }
    Map<DocumentType, DriverDocument> documents = applicationDocuments(profile, vehicle);
    LocalDate today = calendar.today();
    for (DriverDocument document : documents.values()) {
      if (document.getExpiresOn().isBefore(today)) {
        throw new ConflictException(
            "The %s has expired; request changes".formatted(document.getType().getValue()));
      }
    }

    Instant now = calendar.now();
    profile.setApplicationStatus(ApplicationStatus.APPROVED);
    profile.setDecidedAt(now);
    profile.setDecidedBy(actorUserId);
    profile.setPersonalReviewStatus(ReviewStatus.APPROVED);
    profile = driverProfileRepository.saveAndFlush(profile);

    vehicleRepository
        .findByDriverUserIdAndActiveTrue(profile.getUserId())
        .filter(active -> !active.getId().equals(vehicle.getId()))
        .ifPresent(
            active -> {
              active.setActive(false);
              vehicleRepository.saveAndFlush(active);
            });
    vehicle.setReviewStatus(ReviewStatus.APPROVED);
    vehicle.setReviewedBy(actorUserId);
    vehicle.setReviewedAt(now);
    vehicle.setServiceTypeIds(new HashSet<>(serviceTypeIds));
    vehicle.setActive(true);
    vehicleRepository.saveAndFlush(vehicle);
    for (DriverDocument document : documents.values()) {
      document.setReviewStatus(ReviewStatus.APPROVED);
      document.setReviewedBy(actorUserId);
      document.setReviewedAt(now);
      driverDocumentRepository.saveAndFlush(document);
    }
    driverRoleService.grantDriverRole(profile.getUserId());

    recordEvent(profile, from, ApplicationStatus.APPROVED, null, actorUserId);
    notificationService.queue(profile.getUserId(), NotificationEvent.DRIVER_APPLICATION_APPROVED);
    Map<String, Object> after = new LinkedHashMap<>();
    after.put("status", ApplicationStatus.APPROVED.getValue());
    after.put("vehicleId", vehicle.getId().toString());
    after.put("serviceTypeIds", serviceTypeIds.stream().map(UUID::toString).toList());
    auditService.record(
        actorUserId,
        "driver_application.approve",
        TARGET_TYPE,
        profile.getId().toString(),
        Map.of("status", from.getValue()),
        after);
    return toAdminDto(profile);
  }

  @Override
  public AdminDriverApplicationDto reject(
      UUID actorUserId, UUID applicationId, ReasonRequestDto request) {
    DriverProfile profile = requireProfile(applicationId);
    ApplicationStatus from = profile.getApplicationStatus();
    ApplicationStateMachine.requireTransition(from, ApplicationStatus.REJECTED);
    String reason = request.reason().strip();

    Instant now = calendar.now();
    profile.setApplicationStatus(ApplicationStatus.REJECTED);
    profile.setRejectionReason(reason);
    profile.setDecidedAt(now);
    profile.setDecidedBy(actorUserId);
    profile = driverProfileRepository.saveAndFlush(profile);

    // Close the application's open items so a reapplication can open new ones (V6 indexes).
    Vehicle vehicle = applicationVehicle(profile);
    if (OPEN.contains(vehicle.getReviewStatus())) {
      vehicle.setReviewStatus(ReviewStatus.REJECTED);
      vehicle.setReviewNote(reason);
      vehicle.setReviewedBy(actorUserId);
      vehicle.setReviewedAt(now);
      vehicleRepository.saveAndFlush(vehicle);
    }
    for (DriverDocument document : applicationDocuments(profile, vehicle).values()) {
      if (OPEN.contains(document.getReviewStatus())) {
        document.setReviewStatus(ReviewStatus.REJECTED);
        document.setReviewNote(reason);
        document.setReviewedBy(actorUserId);
        document.setReviewedAt(now);
        driverDocumentRepository.saveAndFlush(document);
      }
    }

    recordEvent(profile, from, ApplicationStatus.REJECTED, reason, actorUserId);
    notificationService.queue(profile.getUserId(), NotificationEvent.DRIVER_APPLICATION_REJECTED);
    auditService.record(
        actorUserId,
        "driver_application.reject",
        TARGET_TYPE,
        profile.getId().toString(),
        Map.of("status", from.getValue()),
        Map.of("status", ApplicationStatus.REJECTED.getValue(), "reason", reason));
    return toAdminDto(profile);
  }

  @Override
  @Transactional(readOnly = true)
  public List<ServiceTypeRefDto> assignableServiceTypes() {
    List<Region> activeRegions = regionRepository.findByStateOrderByNameAsc(RegionState.ACTIVE);
    if (activeRegions.isEmpty()) {
      return List.of();
    }
    return assembler.serviceTypeRefs(
        serviceTypeRepository.findByRegionIdInAndEnabledTrue(
            activeRegions.stream().map(Region::getId).toList()),
        activeRegions);
  }

  /**
   * The application's vehicle: the active one once approved, otherwise the newest submitted (an
   * applicant cannot switch, so that is the application's).
   */
  private Vehicle applicationVehicle(DriverProfile profile) {
    if (profile.getApplicationStatus() == ApplicationStatus.APPROVED) {
      return vehicleRepository
          .findByDriverUserIdAndActiveTrue(profile.getUserId())
          .or(
              () ->
                  vehicleRepository.findFirstByDriverUserIdOrderByCreatedAtDesc(
                      profile.getUserId()))
          .orElseThrow(() -> new IllegalStateException("Approved driver without a vehicle"));
    }
    return vehicleRepository
        .findFirstByDriverUserIdOrderByCreatedAtDesc(profile.getUserId())
        .orElseThrow(() -> new IllegalStateException("Driver application without a vehicle"));
  }

  /**
   * The application's four current documents: the approved row of each slot once approved,
   * otherwise the newest non-superseded row.
   */
  private Map<DocumentType, DriverDocument> applicationDocuments(
      DriverProfile profile, Vehicle vehicle) {
    List<DriverDocument> all =
        driverDocumentRepository.findByDriverUserIdOrderByCreatedAtAsc(profile.getUserId());
    boolean approved = profile.getApplicationStatus() == ApplicationStatus.APPROVED;
    Map<DocumentType, DriverDocument> documents = new EnumMap<>(DocumentType.class);
    for (DocumentType type : DocumentType.values()) {
      (approved
              ? DocumentSlots.currentOrLatest(all, type, vehicle.getId())
              : DocumentSlots.latestNonSuperseded(all, type, vehicle.getId()))
          .ifPresent(document -> documents.put(type, document));
    }
    return documents;
  }

  private boolean isDuplicatePlate(Vehicle vehicle) {
    return vehicleRepository.existsByPlateAndActiveTrueAndDriverUserIdNot(
        vehicle.getPlate(), vehicle.getDriverUserId());
  }

  private void validateChangeItems(List<RequestChangesItemDto> items) {
    Set<String> seen = new HashSet<>();
    for (RequestChangesItemDto item : items) {
      boolean isDocument = item.item() == ReviewItem.DOCUMENT;
      if (isDocument != (item.documentType() != null)) {
        throw new FieldValidationException(
            Map.of("items", "documentType is required for, and only for, document items"));
      }
      String key =
          isDocument ? "document:" + item.documentType().getValue() : item.item().getValue();
      if (!seen.add(key)) {
        throw new FieldValidationException(Map.of("items", "each item may be flagged only once"));
      }
    }
  }

  private Set<ApplicationStatus> parseStatuses(List<String> statuses) {
    if (statuses == null || statuses.isEmpty()) {
      return DEFAULT_QUEUE;
    }
    Set<ApplicationStatus> parsed = EnumSet.noneOf(ApplicationStatus.class);
    for (String status : statuses) {
      try {
        parsed.add(ApplicationStatus.fromValue(status.strip()));
      } catch (IllegalArgumentException ex) {
        throw new InvalidRequestException("Unknown application status: " + status);
      }
    }
    return parsed;
  }

  private void applyVehicleInput(Vehicle vehicle, VehicleInputDto input) {
    vehicle.setMake(input.make().strip());
    vehicle.setModel(input.model().strip());
    vehicle.setYear(input.year().shortValue());
    vehicle.setColor(input.color().strip());
    vehicle.setPlate(OnboardingValidator.normalizePlate(input.plate()));
    vehicle.setSeats(input.seats().shortValue());
    vehicle.setPhotoFileIds(new ArrayList<>(input.photoFileIds()));
    vehicle.setReviewStatus(ReviewStatus.PENDING);
  }

  private static DriverDocument newDocument(UUID userId, DocumentInputDto input, UUID vehicleId) {
    return DriverDocument.builder()
        .driverUserId(userId)
        .type(input.type())
        .vehicleId(DocumentSlots.slotVehicle(input.type(), vehicleId))
        .number(input.number().strip())
        .expiresOn(input.expiresOn())
        .storedFileId(input.fileId())
        .reviewStatus(ReviewStatus.PENDING)
        .build();
  }

  private void recordEvent(
      DriverProfile profile,
      ApplicationStatus from,
      ApplicationStatus to,
      String note,
      UUID actorUserId) {
    driverApplicationEventRepository.save(
        DriverApplicationEvent.builder()
            .driverProfileId(profile.getId())
            .fromStatus(from)
            .toStatus(to)
            .note(note)
            .actorUserId(actorUserId)
            .build());
  }

  private DriverApplicationDto toApplicationDto(DriverProfile profile, User user) {
    Vehicle vehicle = applicationVehicle(profile);
    Map<DocumentType, DriverDocument> documents = applicationDocuments(profile, vehicle);
    List<ApplicationEventDto> history =
        driverApplicationEventRepository
            .findByDriverProfileIdOrderByCreatedAtAsc(profile.getId())
            .stream()
            .map(
                event ->
                    new ApplicationEventDto(
                        event.getFromStatus(),
                        event.getToStatus(),
                        event.getNote(),
                        event.getCreatedAt()))
            .toList();
    return new DriverApplicationDto(
        profile.getId(),
        profile.getApplicationStatus(),
        profile.getSubmittedAt(),
        profile.getDecidedAt(),
        profile.getRejectionReason(),
        new PersonalItemDto(
            user.getName(),
            assembler.profilePhoto(user),
            profile.getPersonalReviewStatus(),
            profile.getPersonalReviewNote()),
        documents.values().stream().map(assembler::document).toList(),
        assembler.vehicle(vehicle),
        history);
  }

  private AdminDriverApplicationDto toAdminDto(DriverProfile profile) {
    User user = requireUser(profile.getUserId());
    Vehicle vehicle = applicationVehicle(profile);
    return new AdminDriverApplicationDto(
        toApplicationDto(profile, user), assembler.applicant(user), isDuplicatePlate(vehicle));
  }

  private DriverProfile requireProfile(UUID applicationId) {
    return driverProfileRepository
        .findById(applicationId)
        .orElseThrow(() -> new ResourceNotFoundException("Driver application", applicationId));
  }

  private DriverProfile requireOwnProfile(UUID userId) {
    return driverProfileRepository
        .findByUserId(userId)
        .orElseThrow(() -> new ResourceNotFoundException("You have not applied to drive"));
  }

  private User requireUser(UUID userId) {
    return userRepository
        .findById(userId)
        .orElseThrow(() -> new UnauthorizedException("Authentication required"));
  }
}
