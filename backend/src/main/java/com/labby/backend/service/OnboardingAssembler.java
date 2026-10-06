package com.labby.backend.service;

import com.labby.backend.dto.ApplicantDto;
import com.labby.backend.dto.DocumentDto;
import com.labby.backend.dto.FileAccessUrlDto;
import com.labby.backend.dto.FileRefDto;
import com.labby.backend.dto.ServiceTypeRefDto;
import com.labby.backend.dto.VehicleDto;
import com.labby.backend.dto.VehicleWithDocumentsDto;
import com.labby.backend.enums.DocumentType;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.DriverDocument;
import com.labby.backend.model.Region;
import com.labby.backend.model.ServiceType;
import com.labby.backend.model.StoredFile;
import com.labby.backend.model.User;
import com.labby.backend.model.Vehicle;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import com.labby.backend.repository.StoredFileRepository;
import com.labby.backend.repository.UserRepository;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Builds the onboarding API views. Every {@link FileRefDto} gets a freshly minted, expiring URL
 * (NFR-S2) — so this assembler may only be called AFTER the endpoint's own authentication +
 * permission check (applicant → own data; admin → {@code driver-review:view}).
 */
@Component
@RequiredArgsConstructor
public class OnboardingAssembler {

  private static final Map<String, String> PHOTO_TYPES =
      Map.of(".jpg", "image/jpeg", ".png", "image/png", ".webp", "image/webp");

  private final StorageProvider storageProvider;
  private final StoredFileRepository storedFileRepository;
  private final ServiceTypeRepository serviceTypeRepository;
  private final RegionRepository regionRepository;
  private final UserRepository userRepository;

  /**
   * A stored file with a fresh expiring URL.
   *
   * @param storedFileId the file
   * @return the file reference
   */
  public FileRefDto fileRef(UUID storedFileId) {
    StoredFile file =
        storedFileRepository
            .findById(storedFileId)
            .orElseThrow(() -> new ResourceNotFoundException("StoredFile", storedFileId));
    FileAccessUrlDto access =
        storageProvider.accessUrl(file.getStorageKey(), file.getContentType());
    return new FileRefDto(file.getId(), file.getContentType(), access.url(), access.expiresAt());
  }

  /**
   * The account's profile photo (the personal item) with a fresh expiring URL. The photo has no
   * stored-file row (M2 storage), so its {@code fileId} is the account id.
   *
   * @param user the account
   * @return the file reference, or null without a photo
   */
  public FileRefDto profilePhoto(User user) {
    String key = user.getPhotoPath();
    if (key == null) {
      return null;
    }
    String contentType =
        PHOTO_TYPES.entrySet().stream()
            .filter(entry -> key.endsWith(entry.getKey()))
            .map(Map.Entry::getValue)
            .findFirst()
            .orElse("application/octet-stream");
    FileAccessUrlDto access = storageProvider.accessUrl(key, contentType);
    return new FileRefDto(user.getId(), contentType, access.url(), access.expiresAt());
  }

  /**
   * A document view.
   *
   * @param document the row
   * @return the view
   */
  public DocumentDto document(DriverDocument document) {
    return new DocumentDto(
        document.getId(),
        document.getType(),
        document.getVehicleId(),
        document.getNumber(),
        document.getExpiresOn(),
        fileRef(document.getStoredFileId()),
        document.getReviewStatus(),
        document.getReviewNote(),
        document.getCreatedAt());
  }

  /**
   * A vehicle view (photos + assigned service types). Reads LAZY collections — call inside the
   * service transaction.
   *
   * @param vehicle the row
   * @return the view
   */
  public VehicleDto vehicle(Vehicle vehicle) {
    return new VehicleDto(
        vehicle.getId(),
        vehicle.getMake(),
        vehicle.getModel(),
        vehicle.getYear(),
        vehicle.getColor(),
        vehicle.getPlate(),
        vehicle.getSeats(),
        vehicle.getPhotoFileIds().stream().map(this::fileRef).toList(),
        vehicle.getReviewStatus(),
        vehicle.getReviewNote(),
        vehicle.isActive(),
        serviceTypeRefs(vehicle.getServiceTypeIds()),
        vehicle.getCreatedAt());
  }

  /**
   * A vehicle with its current registration + insurance (approved row, else the newest
   * non-superseded one).
   *
   * @param vehicle the vehicle
   * @param driverDocuments all of the driver's document rows, oldest first
   * @return the view
   */
  public VehicleWithDocumentsDto vehicleWithDocuments(
      Vehicle vehicle, List<DriverDocument> driverDocuments) {
    List<DocumentDto> documents =
        List.of(DocumentType.VEHICLE_REGISTRATION, DocumentType.INSURANCE).stream()
            .map(type -> DocumentSlots.currentOrLatest(driverDocuments, type, vehicle.getId()))
            .flatMap(Optional::stream)
            .map(this::document)
            .toList();
    return new VehicleWithDocumentsDto(vehicle(vehicle), documents);
  }

  /**
   * The account as shown to reviewers.
   *
   * @param user the account
   * @return the view
   */
  public ApplicantDto applicant(User user) {
    return new ApplicantDto(user.getId(), user.getName(), user.getPhone());
  }

  /**
   * The account as shown to reviewers, by id.
   *
   * @param userId the account id
   * @return the view
   */
  public ApplicantDto applicant(UUID userId) {
    return applicant(
        userRepository
            .findById(userId)
            .orElseThrow(() -> new ResourceNotFoundException("User", userId)));
  }

  /**
   * Service types with their regions, region-then-name sorted.
   *
   * @param serviceTypeIds the ids
   * @return the references
   */
  public List<ServiceTypeRefDto> serviceTypeRefs(Collection<UUID> serviceTypeIds) {
    if (serviceTypeIds.isEmpty()) {
      return List.of();
    }
    return serviceTypeRefs(serviceTypeRepository.findAllById(serviceTypeIds), null);
  }

  /**
   * Service types with their regions, region-then-name sorted.
   *
   * @param serviceTypes the types
   * @param regions their regions, or null to load them
   * @return the references
   */
  public List<ServiceTypeRefDto> serviceTypeRefs(
      List<ServiceType> serviceTypes, Collection<Region> regions) {
    Map<UUID, Region> regionsById =
        (regions != null
                ? regions
                : regionRepository.findAllById(
                    serviceTypes.stream().map(ServiceType::getRegionId).distinct().toList()))
            .stream().collect(Collectors.toMap(Region::getId, Function.identity()));
    return serviceTypes.stream()
        .map(
            type ->
                new ServiceTypeRefDto(
                    type.getId(),
                    type.getRegionId(),
                    regionsById.get(type.getRegionId()).getName(),
                    type.getNameEn(),
                    type.getNameAr()))
        .sorted(
            Comparator.comparing(ServiceTypeRefDto::regionName)
                .thenComparing(ServiceTypeRefDto::nameEn))
        .toList();
  }
}
