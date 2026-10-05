package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.enums.DocumentType;
import com.labby.backend.enums.ReviewStatus;
import com.labby.backend.enums.StoredFileKind;
import com.labby.backend.model.DriverApplicationEvent;
import com.labby.backend.model.DriverDocument;
import com.labby.backend.model.DriverProfile;
import com.labby.backend.model.NotificationOutboxEntry;
import com.labby.backend.model.StoredFile;
import com.labby.backend.model.Vehicle;
import com.labby.backend.repository.DriverApplicationEventRepository;
import com.labby.backend.repository.DriverDocumentRepository;
import com.labby.backend.repository.DriverProfileRepository;
import com.labby.backend.repository.NotificationOutboxRepository;
import com.labby.backend.repository.StoredFileRepository;
import com.labby.backend.repository.VehicleRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * M5-T1 acceptance: V6 migrates cleanly (context boot) and the onboarding invariants hold at the
 * DATABASE level — one active vehicle per driver (DRV-03), only approved vehicles active, one
 * vehicle in review at a time, document↔vehicle binding, one approved + one open document per slot
 * (renewal beside the current one), one profile per account, PDF only for documents, and the
 * suspension-reason rule. Entities round-trip their collections and JSON.
 */
class OnboardingMigrationIntegrationTest extends AbstractIntegrationTest {

  @Autowired private JdbcTemplate jdbcTemplate;
  @Autowired private StoredFileRepository storedFileRepository;
  @Autowired private DriverProfileRepository driverProfileRepository;
  @Autowired private DriverApplicationEventRepository driverApplicationEventRepository;
  @Autowired private VehicleRepository vehicleRepository;
  @Autowired private DriverDocumentRepository driverDocumentRepository;
  @Autowired private NotificationOutboxRepository notificationOutboxRepository;
  @Autowired private TransactionTemplate transactionTemplate;

  private final List<UUID> createdUsers = new ArrayList<>();
  private UUID createdRegion;

  @AfterEach
  void cleanOwnRows() {
    for (UUID userId : createdUsers) {
      jdbcTemplate.update("DELETE FROM notification_outbox WHERE user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM documents WHERE driver_user_id = ?", userId);
      jdbcTemplate.update(
          "DELETE FROM vehicle_photos WHERE vehicle_id IN"
              + " (SELECT vehicle_id FROM vehicles WHERE driver_user_id = ?)",
          userId);
      jdbcTemplate.update(
          "DELETE FROM vehicle_service_types WHERE vehicle_id IN"
              + " (SELECT vehicle_id FROM vehicles WHERE driver_user_id = ?)",
          userId);
      jdbcTemplate.update("DELETE FROM vehicles WHERE driver_user_id = ?", userId);
      jdbcTemplate.update(
          "DELETE FROM driver_application_events WHERE driver_profile_id IN"
              + " (SELECT driver_profile_id FROM driver_profiles WHERE user_id = ?)",
          userId);
      jdbcTemplate.update("DELETE FROM driver_profiles WHERE user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM stored_files WHERE owner_user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM role_assignments WHERE user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM users WHERE user_id = ?", userId);
    }
    createdUsers.clear();
    if (createdRegion != null) {
      jdbcTemplate.update("DELETE FROM service_types WHERE region_id = ?", createdRegion);
      jdbcTemplate.update("DELETE FROM regions WHERE region_id = ?", createdRegion);
      createdRegion = null;
    }
  }

  @Test
  @DisplayName("DRV-03: a second active vehicle for the same driver is rejected by the database")
  void shouldAllowOnlyOneActiveVehiclePerDriver() {
    UUID driver = newUser();
    UUID otherDriver = newUser();
    insertVehicle(driver, "approved", true);
    insertVehicle(driver, "approved", false);
    insertVehicle(otherDriver, "approved", true);

    assertThatThrownBy(() -> insertVehicle(driver, "approved", true))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_vehicles_one_active_per_driver");
  }

  @Test
  @DisplayName("deactivate-then-activate switches the single active vehicle")
  void shouldSwitchActiveVehicle() {
    UUID driver = newUser();
    UUID oldVehicle = insertVehicle(driver, "approved", true);
    UUID newVehicle = insertVehicle(driver, "approved", false);

    jdbcTemplate.update("UPDATE vehicles SET is_active = false WHERE vehicle_id = ?", oldVehicle);
    jdbcTemplate.update("UPDATE vehicles SET is_active = true WHERE vehicle_id = ?", newVehicle);

    assertThat(vehicleRepository.findByDriverUserIdAndActiveTrue(driver))
        .get()
        .extracting(Vehicle::getId)
        .isEqualTo(newVehicle);
  }

  @Test
  @DisplayName("only an approved vehicle may be active")
  void shouldRejectActiveUnapprovedVehicle() {
    UUID driver = newUser();
    assertThatThrownBy(() -> insertVehicle(driver, "pending", true))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_vehicles_active_is_approved");
  }

  @Test
  @DisplayName("at most one vehicle in review per driver (one switch at a time)")
  void shouldAllowOnlyOneOpenVehiclePerDriver() {
    UUID driver = newUser();
    insertVehicle(driver, "approved", true);
    insertVehicle(driver, "rejected", false);
    insertVehicle(driver, "pending", false);

    assertThatThrownBy(() -> insertVehicle(driver, "changes_requested", false))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_vehicles_one_open_per_driver");
  }

  @Test
  @DisplayName("vehicle photos: positions 1..4 only")
  void shouldCapVehiclePhotosAtFour() {
    UUID driver = newUser();
    UUID vehicle = insertVehicle(driver, "pending", false);
    UUID photo = insertFile(driver, "vehicle_photo", "image/jpeg");

    jdbcTemplate.update(
        "INSERT INTO vehicle_photos (vehicle_id, position, stored_file_id) VALUES (?, 4, ?)",
        vehicle,
        photo);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO vehicle_photos (vehicle_id, position, stored_file_id)"
                        + " VALUES (?, 5, ?)",
                    vehicle,
                    photo))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_vehicle_photos_position");
  }

  @Test
  @DisplayName("registration/insurance require a vehicle; ID/licence must not have one")
  void shouldBindVehicleDocumentsToAVehicle() {
    UUID driver = newUser();
    UUID vehicle = insertVehicle(driver, "pending", false);
    UUID file = insertFile(driver, "document", "application/pdf");

    insertDocument(driver, null, "government_id", "pending", file);
    insertDocument(driver, vehicle, "insurance", "pending", file);

    assertThatThrownBy(() -> insertDocument(driver, null, "vehicle_registration", "pending", file))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_documents_vehicle_binding");
    assertThatThrownBy(() -> insertDocument(driver, vehicle, "drivers_license", "pending", file))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_documents_vehicle_binding");
  }

  @Test
  @DisplayName("per slot: one approved + one open document (renewal), never two of either")
  void shouldAllowOneApprovedAndOneOpenDocumentPerSlot() {
    UUID driver = newUser();
    UUID vehicle = insertVehicle(driver, "approved", true);
    UUID file = insertFile(driver, "document", "image/png");

    insertDocument(driver, null, "drivers_license", "approved", file);
    insertDocument(driver, null, "drivers_license", "pending", file);
    insertDocument(driver, null, "drivers_license", "superseded", file);
    insertDocument(driver, null, "drivers_license", "rejected", file);
    insertDocument(driver, vehicle, "insurance", "approved", file);

    // NULLS NOT DISTINCT: the vehicle-less slot still counts as one slot.
    assertThatThrownBy(() -> insertDocument(driver, null, "drivers_license", "approved", file))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_documents_one_approved_per_slot");
    assertThatThrownBy(
            () -> insertDocument(driver, null, "drivers_license", "changes_requested", file))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_documents_one_open_per_slot");
    assertThatThrownBy(() -> insertDocument(driver, vehicle, "insurance", "approved", file))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_documents_one_approved_per_slot");
  }

  @Test
  @DisplayName("one driver profile per account; rejection reason exactly while rejected")
  void shouldEnforceProfileInvariants() {
    UUID user = newUser();
    jdbcTemplate.update("INSERT INTO driver_profiles (user_id) VALUES (?)", user);

    assertThatThrownBy(
            () -> jdbcTemplate.update("INSERT INTO driver_profiles (user_id) VALUES (?)", user))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_driver_profiles_user");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE driver_profiles SET application_status = 'rejected' WHERE user_id = ?",
                    user))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_driver_profiles_rejection_reason");
  }

  @Test
  @DisplayName("PDFs are accepted for documents only, never as vehicle photos")
  void shouldRejectPdfVehiclePhotos() {
    UUID user = newUser();
    insertFile(user, "document", "application/pdf");
    assertThatThrownBy(() -> insertFile(user, "vehicle_photo", "application/pdf"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_stored_files_pdf_documents_only");
  }

  @Test
  @DisplayName("suspension reason only on a suspended role, and only known reasons")
  void shouldGuardSuspensionReason() {
    UUID user = newUser();
    jdbcTemplate.update(
        "INSERT INTO role_assignments (user_id, role, state, suspension_reason)"
            + " VALUES (?, 'driver', 'suspended', 'document_expired')",
        user);

    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE role_assignments SET state = 'active' WHERE user_id = ?", user))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_role_assignments_suspension_reason");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE role_assignments SET suspension_reason = 'bad_mood' WHERE user_id = ?",
                    user))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_role_assignments_suspension_reason");
  }

  @Test
  @DisplayName("entities round-trip: ordered photos, service types, enums, history, outbox JSON")
  void shouldRoundTripEntities() {
    UUID driver = newUser();
    UUID serviceType = insertServiceType();
    StoredFile photoA = storeFile(driver, StoredFileKind.VEHICLE_PHOTO, "image/jpeg");
    StoredFile photoB = storeFile(driver, StoredFileKind.VEHICLE_PHOTO, "image/png");
    StoredFile scan = storeFile(driver, StoredFileKind.DOCUMENT, "application/pdf");

    DriverProfile profile =
        driverProfileRepository.save(DriverProfile.builder().userId(driver).build());
    driverApplicationEventRepository.save(
        DriverApplicationEvent.builder()
            .driverProfileId(profile.getId())
            .toStatus(ApplicationStatus.SUBMITTED)
            .actorUserId(driver)
            .build());
    Vehicle vehicle =
        vehicleRepository.save(
            Vehicle.builder()
                .driverUserId(driver)
                .make("Kia")
                .model("Rio")
                .year((short) 2019)
                .color("White")
                .plate("دمشق123456")
                .seats((short) 4)
                .reviewStatus(ReviewStatus.APPROVED)
                .active(true)
                .photoFileIds(new ArrayList<>(List.of(photoB.getId(), photoA.getId())))
                .serviceTypeIds(Set.of(serviceType))
                .build());
    driverDocumentRepository.save(
        DriverDocument.builder()
            .driverUserId(driver)
            .vehicleId(vehicle.getId())
            .type(DocumentType.INSURANCE)
            .number("INS-1")
            .expiresOn(LocalDate.now().plusYears(1))
            .storedFileId(scan.getId())
            .build());
    notificationOutboxRepository.save(
        NotificationOutboxEntry.builder()
            .userId(driver)
            .event("driver_application.submitted")
            .params(Map.of("applicationId", profile.getId().toString()))
            .build());

    DriverProfile loadedProfile = driverProfileRepository.findByUserId(driver).orElseThrow();
    assertThat(loadedProfile.getApplicationStatus()).isEqualTo(ApplicationStatus.SUBMITTED);
    assertThat(loadedProfile.getPersonalReviewStatus()).isEqualTo(ReviewStatus.PENDING);
    assertThat(loadedProfile.getSubmittedAt()).isNotNull();
    assertThat(
            driverApplicationEventRepository.findByDriverProfileIdOrderByCreatedAtAsc(
                profile.getId()))
        .singleElement()
        .satisfies(event -> assertThat(event.getFromStatus()).isNull());

    // Collections are lazy (services read them inside their transaction).
    transactionTemplate.executeWithoutResult(
        status -> {
          Vehicle loadedVehicle =
              vehicleRepository.findByDriverUserIdAndActiveTrue(driver).orElseThrow();
          assertThat(loadedVehicle.getPhotoFileIds())
              .containsExactly(photoB.getId(), photoA.getId());
          assertThat(loadedVehicle.getServiceTypeIds()).containsExactly(serviceType);
        });
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT stored_file_id FROM vehicle_photos WHERE vehicle_id = ? AND position = 1",
                UUID.class,
                vehicle.getId()))
        .isEqualTo(photoB.getId());
    assertThat(vehicleRepository.existsByPlateAndActiveTrueAndDriverUserIdNot("دمشق123456", driver))
        .isFalse();
    assertThat(
            vehicleRepository.existsByPlateAndActiveTrueAndDriverUserIdNot(
                "دمشق123456", UUID.randomUUID()))
        .isTrue();

    assertThat(
            driverDocumentRepository.findByDriverUserIdAndReviewStatusIn(
                driver, List.of(ReviewStatus.PENDING)))
        .singleElement()
        .satisfies(doc -> assertThat(doc.getType()).isEqualTo(DocumentType.INSURANCE));
    assertThat(notificationOutboxRepository.findByUserIdOrderByCreatedAtAsc(driver))
        .singleElement()
        .satisfies(
            entry ->
                assertThat(entry.getParams())
                    .containsEntry("applicationId", profile.getId().toString()));
    assertThat(storedFileRepository.findByIdAndOwnerUserId(scan.getId(), driver)).isPresent();
    assertThat(storedFileRepository.findByIdAndOwnerUserId(scan.getId(), UUID.randomUUID()))
        .isEmpty();
  }

  private UUID newUser() {
    UUID userId = UUID.randomUUID();
    String phone =
        "+9639%08d".formatted(Math.floorMod(userId.getMostSignificantBits(), 100_000_000L));
    jdbcTemplate.update(
        "INSERT INTO users (user_id, phone, password_hash, name, terms_accepted_at) VALUES"
            + " (?, ?, 'x', 'Onboarding Test User', now())",
        userId,
        phone);
    createdUsers.add(userId);
    return userId;
  }

  private UUID insertVehicle(UUID driver, String reviewStatus, boolean active) {
    UUID vehicleId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO vehicles (vehicle_id, driver_user_id, make, model, year, color, plate, seats,"
            + " review_status, is_active) VALUES (?, ?, 'Kia', 'Rio', 2019, 'White', ?, 4, ?, ?)",
        vehicleId,
        driver,
        "PLATE" + vehicleId.toString().substring(0, 8),
        reviewStatus,
        active);
    return vehicleId;
  }

  private UUID insertFile(UUID owner, String kind, String contentType) {
    UUID fileId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO stored_files (stored_file_id, owner_user_id, kind, storage_key, content_type,"
            + " size_bytes) VALUES (?, ?, ?, ?, ?, 100)",
        fileId,
        owner,
        kind,
        "driver-files/" + fileId,
        contentType);
    return fileId;
  }

  private StoredFile storeFile(UUID owner, StoredFileKind kind, String contentType) {
    return storedFileRepository.save(
        StoredFile.builder()
            .ownerUserId(owner)
            .kind(kind)
            .storageKey("driver-files/" + UUID.randomUUID())
            .contentType(contentType)
            .sizeBytes(100)
            .build());
  }

  private void insertDocument(
      UUID driver, UUID vehicle, String type, String reviewStatus, UUID file) {
    jdbcTemplate.update(
        "INSERT INTO documents (driver_user_id, vehicle_id, type, number, expires_on,"
            + " stored_file_id, review_status) VALUES (?, ?, ?, 'N-1', ?, ?, ?)",
        driver,
        vehicle,
        type,
        LocalDate.now().plusYears(1),
        file,
        reviewStatus);
  }

  private UUID insertServiceType() {
    createdRegion = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO regions (region_id, name) VALUES (?, ?)",
        createdRegion,
        "Onboarding Test Region " + createdRegion);
    UUID serviceTypeId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO service_types (service_type_id, region_id, name_en, name_ar, base_fare,"
            + " per_km_rate, per_min_rate, minimum_fare) VALUES (?, ?, 'Economy', 'اقتصادي', 1, 1,"
            + " 1, 1)",
        serviceTypeId,
        createdRegion);
    return serviceTypeId;
  }
}
