package com.labby.backend.service;

import com.labby.backend.config.CommsProperties;
import com.labby.backend.config.TrackingProperties;
import com.labby.backend.dto.FileRefDto;
import com.labby.backend.dto.ShareLinkDto;
import com.labby.backend.dto.SharePageDto;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.GoneException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Ride;
import com.labby.backend.model.TripShareLink;
import com.labby.backend.model.User;
import com.labby.backend.model.Vehicle;
import com.labby.backend.repository.DriverLocationRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.TripShareLinkRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.repository.VehicleRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Trip sharing (SHARE-01/02). The token is 256 random bits, URL-safe base64; only its SHA-256 hex
 * ever touches the database, so the raw url exists exactly once — in the 201. Liveness derives from
 * the ride's state: unknown tokens are 404, terminal rides 410 for ever.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class ShareServiceImpl implements ShareService {

  /** 256-bit tokens (T6 share-token security review). */
  static final int TOKEN_BYTES = 32;

  private static final SecureRandom RANDOM = new SecureRandom();

  /** V15's one-link-per-user-per-ride constraint. */
  private static final String RIDE_USER_CONSTRAINT = "uq_trip_share_links_ride_user";

  private final TripShareLinkRepository tripShareLinkRepository;
  private final RideRepository rideRepository;
  private final UserRepository userRepository;
  private final VehicleRepository vehicleRepository;
  private final DriverLocationRepository driverLocationRepository;
  private final OnboardingAssembler onboardingAssembler;
  private final CommsProperties commsProperties;
  private final TrackingProperties trackingProperties;
  private final RideParties rideParties;
  private final Clock clock;

  @Override
  public ShareLinkDto create(UUID userId, UUID rideId) {
    Ride ride =
        rideRepository
            .findById(rideId)
            // M12: a member riding along shares the trip like the ride's rider.
            .filter(candidate -> rideParties.sideOf(candidate, userId, RideParties.RIDING) != null)
            .orElseThrow(() -> new ResourceNotFoundException("Ride not found"));
    if (!ride.isAssigned()) {
      // Before acceptance there is nothing to show; after the end the link would be dead.
      throw (ConflictException)
          new ConflictException("Sharing is available during an active accepted ride")
              .withCode("ride_not_active");
    }
    if (tripShareLinkRepository.existsByRideIdAndCreatedByUserId(rideId, userId)) {
      // One link per user per ride (owner ruling): the raw url was served once, at creation.
      throw alreadyShared();
    }
    byte[] raw = new byte[TOKEN_BYTES];
    RANDOM.nextBytes(raw);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    TripShareLink link;
    try {
      link =
          tripShareLinkRepository.saveAndFlush(
              TripShareLink.builder()
                  .rideId(rideId)
                  .createdByUserId(userId)
                  .tokenHash(sha256Hex(token))
                  .createdAt(clock.instant())
                  .build());
    } catch (DataIntegrityViolationException ex) {
      // A concurrent double tap passed the check too: the unique (ride, user) row decides.
      if (String.valueOf(ex.getMostSpecificCause().getMessage()).contains(RIDE_USER_CONSTRAINT)) {
        throw alreadyShared();
      }
      throw ex;
    }
    return new ShareLinkDto(
        commsProperties.publicBaseUrl() + "/share/" + token, link.getCreatedAt());
  }

  /** A shared ride's link of a member who is no longer riding along (cancelled / no-show). */
  private boolean memberLeft(Ride ride, UUID sharerUserId) {
    return !sharerUserId.equals(ride.getDriverUserId())
        && rideParties.sideOf(ride, sharerUserId, RideParties.RIDING) == null;
  }

  @Override
  @Transactional(readOnly = true)
  public SharePageDto page(String token) {
    TripShareLink link =
        tripShareLinkRepository
            .findByTokenHash(sha256Hex(token))
            .orElseThrow(() -> new ResourceNotFoundException("Unknown share link"));
    Ride ride = rideRepository.findById(link.getRideId()).orElseThrow();
    if (!ride.isAssigned() || memberLeft(ride, link.getCreatedByUserId())) {
      // UC-S-15 E1: the moment the ride is terminal the link is dead for ever — on a shared ride
      // also the moment its sharing member left it (review I2, owner ruling 2026-10-17).
      throw new GoneException("This trip has ended");
    }
    User driver = userRepository.findById(ride.getDriverUserId()).orElseThrow();
    Vehicle vehicle = vehicleRepository.findById(ride.getVehicleId()).orElseThrow();
    FileRefDto photo = onboardingAssembler.profilePhoto(driver);
    return new SharePageDto(
        ride.getState(),
        RideAssembler.firstName(driver.getName()),
        photo == null ? null : photo.url(),
        new SharePageDto.ShareVehicleDto(
            vehicle.getModel(), vehicle.getColor(), vehicle.getPlate()),
        position(ride),
        ride.getEtaSeconds(),
        commsProperties.shareRefreshSeconds());
  }

  private static ConflictException alreadyShared() {
    return (ConflictException)
        new ConflictException("You already shared this ride").withCode("already_shared");
  }

  /** The driver's latest position, null when stale (the realtime staleness window) or unknown. */
  private SharePageDto.SharePositionDto position(Ride ride) {
    Instant cutoff = clock.instant().minusSeconds(trackingProperties.staleAfterSeconds());
    return driverLocationRepository
        .findById(ride.getDriverUserId())
        .filter(location -> !location.getReceivedAt().isBefore(cutoff))
        .map(
            location ->
                new SharePageDto.SharePositionDto(
                    location.getPosition().getY(),
                    location.getPosition().getX(),
                    location.getHeadingDeg() == null
                        ? null
                        : location.getHeadingDeg().doubleValue(),
                    location.getRecordedAt()))
        .orElse(null);
  }

  /** SHA-256 of the raw token as lowercase hex — the only stored form. */
  static String sha256Hex(String token) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      return HexFormat.of().formatHex(digest.digest(token.getBytes(StandardCharsets.US_ASCII)));
    } catch (NoSuchAlgorithmException ex) {
      throw new IllegalStateException("SHA-256 unavailable", ex);
    }
  }
}
