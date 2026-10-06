package com.labby.backend.service;

import com.labby.backend.dto.DocumentInputDto;
import com.labby.backend.dto.VehicleInputDto;
import com.labby.backend.enums.DocumentType;
import com.labby.backend.enums.RegionState;
import com.labby.backend.enums.StoredFileKind;
import com.labby.backend.exception.FieldValidationException;
import com.labby.backend.model.Region;
import com.labby.backend.model.ServiceType;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import com.labby.backend.repository.StoredFileRepository;
import java.time.LocalDate;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Onboarding input rules (UC-D-01 E1/E2, UC-D-18/19, DRV-03). Errors are collected per item and
 * keyed per the contract — {@code documents[insurance].expiresOn}, {@code vehicle.photoFileIds},
 * {@code profilePhoto} — so the applicant sees every problem at once; {@link #throwIfAny} turns
 * them into a 400.
 */
@Component
@RequiredArgsConstructor
public class OnboardingValidator {

  static final int MIN_VEHICLE_YEAR = 1980;
  static final int MAX_PHOTOS = 4;
  private static final Pattern WHITESPACE = Pattern.compile("(?U)\\s+");
  private static final String REQUIRED = "is required";

  private final StoredFileRepository storedFileRepository;
  private final ServiceTypeRepository serviceTypeRepository;
  private final RegionRepository regionRepository;
  private final OperatingCalendar calendar;

  /**
   * Validates a set of documents: exactly the expected types, each once, each with valid fields.
   *
   * @param errors collected errors
   * @param documents the submitted documents (null = none)
   * @param expected the types that must be present (no others allowed)
   * @param ownerId the submitting account, owner of every referenced file
   * @param missingMessage the message for an expected type that is absent
   * @param unexpectedMessage the message for a type that is not expected
   * @return the documents by type (only those with a type, first occurrence)
   */
  public Map<DocumentType, DocumentInputDto> validateDocuments(
      Map<String, String> errors,
      List<DocumentInputDto> documents,
      Set<DocumentType> expected,
      UUID ownerId,
      String missingMessage,
      String unexpectedMessage) {
    Map<DocumentType, DocumentInputDto> byType = new EnumMap<>(DocumentType.class);
    for (DocumentInputDto document : documents == null ? List.<DocumentInputDto>of() : documents) {
      if (document == null || document.type() == null) {
        errors.putIfAbsent("documents", "Every document needs a type");
        continue;
      }
      String key = documentKey(document.type());
      if (byType.containsKey(document.type())) {
        errors.putIfAbsent(key, "is given more than once");
        continue;
      }
      byType.put(document.type(), document);
      if (!expected.contains(document.type())) {
        errors.putIfAbsent(key, unexpectedMessage);
      }
    }
    for (DocumentType type : expected) {
      DocumentInputDto document = byType.get(type);
      if (document == null) {
        errors.putIfAbsent(documentKey(type), missingMessage);
      } else {
        validateDocumentFields(
            errors,
            documentKey(type),
            document.number(),
            document.expiresOn(),
            document.fileId(),
            ownerId);
      }
    }
    return byType;
  }

  /**
   * Validates one document's number, expiry (after today, UC-D-01 E2) and file (own upload of kind
   * {@code document}).
   *
   * @param errors collected errors
   * @param prefix the key prefix ({@code documents[type]}), or empty for a flat body
   * @param number the number
   * @param expiresOn the expiry date
   * @param fileId the file
   * @param ownerId the submitting account
   */
  public void validateDocumentFields(
      Map<String, String> errors,
      String prefix,
      String number,
      LocalDate expiresOn,
      UUID fileId,
      UUID ownerId) {
    requireText(errors, key(prefix, "number"), number, 50);
    if (expiresOn == null) {
      errors.putIfAbsent(key(prefix, "expiresOn"), REQUIRED);
    } else if (!expiresOn.isAfter(calendar.today())) {
      errors.putIfAbsent(key(prefix, "expiresOn"), "must be after today");
    }
    if (fileId == null) {
      errors.putIfAbsent(key(prefix, "fileId"), REQUIRED);
    } else if (!ownsFile(fileId, ownerId, StoredFileKind.DOCUMENT)) {
      errors.putIfAbsent(key(prefix, "fileId"), "must be your own upload of kind document");
    }
  }

  /**
   * Validates the vehicle details and photos (keys {@code vehicle.<field>}).
   *
   * @param errors collected errors
   * @param vehicle the vehicle, may be null
   * @param ownerId the submitting account
   */
  public void validateVehicle(Map<String, String> errors, VehicleInputDto vehicle, UUID ownerId) {
    if (vehicle == null) {
      errors.putIfAbsent("vehicle", REQUIRED);
      return;
    }
    requireText(errors, "vehicle.make", vehicle.make(), 50);
    requireText(errors, "vehicle.model", vehicle.model(), 50);
    requireText(errors, "vehicle.color", vehicle.color(), 30);
    String plate = normalizePlate(vehicle.plate());
    if (plate == null || plate.isEmpty()) {
      errors.putIfAbsent("vehicle.plate", REQUIRED);
    } else if (plate.length() > 20) {
      errors.putIfAbsent("vehicle.plate", "must be at most 20 characters");
    }
    int maxYear = calendar.today().getYear() + 1;
    if (vehicle.year() == null) {
      errors.putIfAbsent("vehicle.year", REQUIRED);
    } else if (vehicle.year() < MIN_VEHICLE_YEAR || vehicle.year() > maxYear) {
      errors.putIfAbsent(
          "vehicle.year", "must be between %d and %d".formatted(MIN_VEHICLE_YEAR, maxYear));
    }
    if (vehicle.seats() == null) {
      errors.putIfAbsent("vehicle.seats", REQUIRED);
    } else if (vehicle.seats() < 1 || vehicle.seats() > 8) {
      errors.putIfAbsent("vehicle.seats", "must be between 1 and 8");
    }
    validatePhotos(errors, vehicle.photoFileIds(), ownerId);
  }

  /**
   * Validates the service types an approval assigns (DRV-03): distinct, existing, enabled, of an
   * ACTIVE region.
   *
   * @param serviceTypeIds the requested ids
   * @return the distinct ids
   * @throws FieldValidationException under {@code serviceTypeIds} (400)
   */
  public Set<UUID> requireAssignableServiceTypes(List<UUID> serviceTypeIds) {
    Set<UUID> distinct = new LinkedHashSet<>(serviceTypeIds);
    if (distinct.size() != serviceTypeIds.size()) {
      throw new FieldValidationException(Map.of("serviceTypeIds", "must not repeat a type"));
    }
    List<ServiceType> found = serviceTypeRepository.findAllById(distinct);
    Set<UUID> activeRegions = new HashSet<>();
    for (Region region : regionRepository.findByStateOrderByNameAsc(RegionState.ACTIVE)) {
      activeRegions.add(region.getId());
    }
    boolean allAssignable =
        found.size() == distinct.size()
            && found.stream()
                .allMatch(type -> type.isEnabled() && activeRegions.contains(type.getRegionId()));
    if (!allAssignable) {
      throw new FieldValidationException(
          Map.of(
              "serviceTypeIds", "every type must be an enabled service type of an active region"));
    }
    return distinct;
  }

  /**
   * Normalizes a plate: upper-cased, all whitespace removed (onboarding-v1.yaml).
   *
   * @param plate the raw plate
   * @return the normalized plate, or null
   */
  public static String normalizePlate(String plate) {
    if (plate == null) {
      return null;
    }
    return WHITESPACE.matcher(plate).replaceAll("").toUpperCase(Locale.ROOT);
  }

  /**
   * The contract key of a document item.
   *
   * @param type the document type
   * @return {@code documents[<type>]}
   */
  public static String documentKey(DocumentType type) {
    return "documents[" + type.getValue() + "]";
  }

  /**
   * Throws a 400 carrying the collected errors, if any.
   *
   * @param errors collected errors
   * @throws FieldValidationException when non-empty
   */
  public static void throwIfAny(Map<String, String> errors) {
    if (!errors.isEmpty()) {
      throw new FieldValidationException(new LinkedHashMap<>(errors));
    }
  }

  private void validatePhotos(Map<String, String> errors, List<UUID> photoFileIds, UUID ownerId) {
    String key = "vehicle.photoFileIds";
    if (photoFileIds == null || photoFileIds.isEmpty()) {
      errors.putIfAbsent(key, "at least one photo is required");
      return;
    }
    if (photoFileIds.size() > MAX_PHOTOS) {
      errors.putIfAbsent(key, "at most %d photos".formatted(MAX_PHOTOS));
      return;
    }
    if (photoFileIds.contains(null) || new HashSet<>(photoFileIds).size() != photoFileIds.size()) {
      errors.putIfAbsent(key, "photos must be distinct file ids");
      return;
    }
    for (UUID fileId : photoFileIds) {
      if (!ownsFile(fileId, ownerId, StoredFileKind.VEHICLE_PHOTO)) {
        errors.putIfAbsent(key, "every photo must be your own upload of kind vehicle_photo");
        return;
      }
    }
  }

  private boolean ownsFile(UUID fileId, UUID ownerId, StoredFileKind kind) {
    return storedFileRepository
        .findByIdAndOwnerUserId(fileId, ownerId)
        .filter(file -> file.getKind() == kind)
        .isPresent();
  }

  private static void requireText(
      Map<String, String> errors, String key, String value, int maxLength) {
    if (value == null || value.isBlank()) {
      errors.putIfAbsent(key, REQUIRED);
    } else if (value.strip().length() > maxLength) {
      errors.putIfAbsent(key, "must be at most %d characters".formatted(maxLength));
    }
  }

  private static String key(String prefix, String field) {
    return prefix.isEmpty() ? field : prefix + "." + field;
  }
}
