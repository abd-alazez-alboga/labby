package com.labby.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.dto.ComfortPreferencesDto;
import com.labby.backend.dto.DepartureDto;
import com.labby.backend.dto.DriverSummaryDto;
import com.labby.backend.dto.EstimateDto;
import com.labby.backend.dto.FareComponentsDto;
import com.labby.backend.dto.FileRefDto;
import com.labby.backend.dto.FinalFareDto;
import com.labby.backend.dto.LatLngPointDto;
import com.labby.backend.dto.MemberViewDto;
import com.labby.backend.dto.PlaceDto;
import com.labby.backend.dto.RideDto;
import com.labby.backend.dto.RideOfferDto;
import com.labby.backend.dto.RideTimelineDto;
import com.labby.backend.dto.RiderSummaryDto;
import com.labby.backend.dto.ScheduledInfoDto;
import com.labby.backend.dto.SharedInfoDto;
import com.labby.backend.dto.SharedOfferInfoDto;
import com.labby.backend.dto.SharedRideDto;
import com.labby.backend.dto.SplitSummaryDto;
import com.labby.backend.dto.VehicleSummaryDto;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.SharedMemberStatus;
import com.labby.backend.model.Fare;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.RideOffer;
import com.labby.backend.model.RiderPreference;
import com.labby.backend.model.ServiceType;
import com.labby.backend.model.SharedRide;
import com.labby.backend.model.SharedRideMember;
import com.labby.backend.model.User;
import com.labby.backend.model.Vehicle;
import com.labby.backend.repository.DriverLocationRepository;
import com.labby.backend.repository.FareRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RiderPreferenceRepository;
import com.labby.backend.repository.ScheduledRideRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import com.labby.backend.repository.SharedRideMemberRepository;
import com.labby.backend.repository.SharedRideRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.repository.VehicleRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.locationtech.jts.geom.Point;
import org.springframework.stereotype.Component;

/**
 * Builds the API views of a ride (rides-v1.yaml): the rider view carries the driver from acceptance
 * on (TRK-02, UC-R-05), the driver view carries the rider (UC-D-06); the admin view carries both.
 * Counterpart ratings are the RATE-02 exposed view (daily snapshot, null below 5 ratings — M11);
 * the rider and driver views carry the caller's own {@code myRating}. Photo URLs are fresh,
 * expiring file URLs (NFR-S2).
 */
@Component
@RequiredArgsConstructor
public class RideAssembler {

  /** SRS §9 wait grace when the region has none set. */
  static final int DEFAULT_WAIT_GRACE_MIN = 5;

  private final ServiceTypeRepository serviceTypeRepository;
  private final FareRepository fareRepository;
  private final UserRepository userRepository;
  private final VehicleRepository vehicleRepository;
  private final RiderPreferenceRepository riderPreferenceRepository;
  private final RideRepository rideRepository;
  private final DriverLocationRepository driverLocationRepository;
  private final RegionRepository regionRepository;
  private final ScheduledRideRepository scheduledRideRepository;
  private final SharedRideRepository sharedRideRepository;
  private final SharedRideMemberRepository sharedRideMemberRepository;
  private final OnboardingAssembler onboardingAssembler;
  private final RideMoneyService rideMoneyService;
  private final RatingService ratingService;
  private final ObjectMapper objectMapper;

  /** Which party a view is for. */
  public enum Audience {
    RIDER,
    DRIVER,
    ADMIN
  }

  /**
   * The ride as the given party sees it.
   *
   * @param ride the ride
   * @param audience rider, driver or admin
   * @return the view
   */
  public RideDto view(Ride ride, Audience audience) {
    return view(
        ride,
        audience,
        audience == Audience.DRIVER ? ride.getDriverUserId() : ride.getRiderUserId());
  }

  /**
   * The ride as one viewer sees it — on a shared ride the rider view carries the VIEWER's own
   * membership ({@code shared.me}, M12).
   *
   * @param ride the ride
   * @param audience rider, driver or admin
   * @param viewerUserId who looks (the member, for a rider view of a shared ride)
   * @return the view
   */
  public RideDto view(Ride ride, Audience audience, UUID viewerUserId) {
    ServiceType serviceType = serviceTypeRepository.findById(ride.getServiceTypeId()).orElseThrow();
    boolean assigned = ride.isAssigned();
    boolean showDriver = audience != Audience.DRIVER && ride.getDriverUserId() != null;
    boolean showRider = audience != Audience.RIDER;
    LatLngPointDto driverPosition =
        audience != Audience.DRIVER && assigned
            ? driverLocationRepository
                .findById(ride.getDriverUserId())
                .map(location -> point(location.getPosition()))
                .orElse(null)
            : null;
    FinalFareDto fare = fareRepository.findById(ride.getId()).map(this::finalFare).orElse(null);
    // scheduled-shared-v1: a member's rider view carries THEIR money and fee, never the ride's.
    SharedRideMember viewer =
        audience == Audience.RIDER && ride.getKind() == RideKind.SHARED
            ? latestMembership(
                sharedRideMemberRepository.findByRideIdOrderByJoinedAtAsc(ride.getId()),
                viewerUserId)
            : null;
    RideMoneyService.RideMoney money =
        viewer != null
            ? rideMoneyService.memberMoney(ride, viewer)
            : rideMoneyService.rideMoney(ride, fare == null ? null : fare.components().total());
    return new RideDto(
        ride.getId(),
        ride.getState(),
        ride.getKind(),
        ride.getRegionId(),
        ride.getServiceTypeId(),
        serviceType.getNameEn(),
        serviceType.getNameAr(),
        place(ride.getPickup(), ride.getPickupLabel()),
        place(ride.getDestination(), ride.getDestinationLabel()),
        stops(ride.getStops()),
        // Review I1: a member sees THEIR payment method, never the creator's.
        viewer != null ? viewer.getPaymentMethod() : ride.getPaymentMethod(),
        ride.getPickupDistanceMode(),
        ride.getSurgeMultiplier(),
        ride.getSurchargePercent(),
        estimate(ride),
        timeline(ride),
        ride.getCancellationGraceEndsAt(),
        waitGraceEndsAt(ride),
        ride.getCancellationReason(),
        viewer != null ? viewer.getCancellationFee() : ride.getCancellationFee(),
        fare,
        ride.getPaymentStatus(),
        money.walletApplied(),
        money.cashDue(),
        money.carriedDues(),
        money.tip(),
        assigned ? (ride.getDriverStreamLostAt() == null ? "ok" : "lost") : null,
        driverPosition,
        assigned ? ride.getEtaSeconds() : null,
        ride.getRetryOfRideId(),
        ride.getRedispatchOfRideId(),
        audience != Audience.DRIVER
            ? rideRepository
                .findFirstByRedispatchOfRideId(ride.getId())
                .map(Ride::getId)
                .orElse(null)
            : null,
        showDriver ? driverSummary(ride.getDriverUserId(), ride.getVehicleId()) : null,
        showRider ? riderSummary(ride.getRiderUserId()) : null,
        switch (audience) {
          case RIDER -> ratingService.myRating(ride, RideParty.RIDER, viewerUserId);
          case DRIVER -> ratingService.myRating(ride, RideParty.DRIVER, viewerUserId);
          case ADMIN -> null;
        },
        ride.getKind() == RideKind.SCHEDULED ? scheduledInfo(ride, audience) : null,
        ride.getKind() == RideKind.SHARED ? sharedInfo(ride, audience, viewerUserId) : null);
  }

  /**
   * The shared extension of a ride (scheduled-shared-v1 SharedInfo): the viewer's own membership in
   * rider views, every party (with first names) in the driver and admin views.
   *
   * @param ride a ride of kind shared
   * @param audience who looks
   * @param viewerUserId the viewer
   * @return the block, or null when the extension row is missing
   */
  public SharedInfoDto sharedInfo(Ride ride, Audience audience, UUID viewerUserId) {
    return sharedRideRepository
        .findById(ride.getId())
        .map(
            shared -> {
              List<SharedRideMember> members =
                  sharedRideMemberRepository.findByRideIdOrderByJoinedAtAsc(ride.getId());
              boolean riderView = audience == Audience.RIDER;
              SharedRideMember mine = riderView ? latestMembership(members, viewerUserId) : null;
              return new SharedInfoDto(
                  shared.getTotalSeats(),
                  shared.getSeatsTaken(),
                  departure(shared),
                  shared.getDispatchTrigger(),
                  shared.getDispatchedAt(),
                  riderView && ride.getRiderUserId().equals(viewerUserId),
                  mine == null ? null : memberView(ride, mine, false),
                  riderView
                      ? List.of()
                      : members.stream().map(m -> memberView(ride, m, true)).toList(),
                  shared.getSplitSeats() == null
                      ? null
                      : new SplitSummaryDto(
                          fareRepository.findById(ride.getId()).map(Fare::getTotal).orElse(null),
                          ride.getCurrency(),
                          shared.getSplitSeats(),
                          shared.getPerSeatAmount()));
            })
        .orElse(null);
  }

  /**
   * A shared ride as a browse card / detail / member view (scheduled-shared-v1 SharedRide).
   *
   * @param ride the ride
   * @param shared its extension
   * @param viewerUserId the looking rider
   * @return the card
   */
  public SharedRideDto sharedRide(Ride ride, SharedRide shared, UUID viewerUserId) {
    ServiceType serviceType = serviceTypeRepository.findById(ride.getServiceTypeId()).orElseThrow();
    SharedRideMember mine =
        latestMembership(
            sharedRideMemberRepository.findByRideIdOrderByJoinedAtAsc(ride.getId()), viewerUserId);
    return new SharedRideDto(
        ride.getId(),
        ride.getState(),
        ride.getRegionId(),
        place(ride.getPickup(), ride.getPickupLabel()),
        place(ride.getDestination(), ride.getDestinationLabel()),
        serviceType.getId(),
        serviceType.getNameEn(),
        serviceType.getNameAr(),
        departure(shared),
        shared.getTotalSeats(),
        shared.getSeatsTaken(),
        shared.seatsLeft(),
        ride.getEstimateTotal(),
        ride.getCurrency(),
        ride.getState() == RideState.GATHERING,
        userRepository
            .findById(ride.getRiderUserId())
            .map(user -> firstName(user.getName()))
            .orElse(""),
        ride.getRiderUserId().equals(viewerUserId),
        mine == null ? null : memberView(ride, mine, false),
        ride.getCancellationReason());
  }

  /**
   * One party as the API shows it.
   *
   * @param ride the shared ride
   * @param member the party
   * @param withName whether to include the first name (driver view only)
   * @return the view
   */
  public MemberViewDto memberView(Ride ride, SharedRideMember member, boolean withName) {
    RideMoneyService.RideMoney money = rideMoneyService.memberMoney(ride, member);
    return new MemberViewDto(
        member.getId(),
        withName
            ? userRepository
                .findById(member.getRiderUserId())
                .map(user -> firstName(user.getName()))
                .orElse("")
            : null,
        member.isCreator(),
        member.getPartySize(),
        member.getStatus(),
        member.getPaymentMethod(),
        member.getJoinedAt(),
        member.getCancellationFee(),
        member.getShareAmount(),
        member.getPaymentStatus(),
        money.walletApplied(),
        money.cashDue());
  }

  private static SharedRideMember latestMembership(List<SharedRideMember> members, UUID userId) {
    SharedRideMember latest = null;
    for (SharedRideMember member : members) {
      if (member.getRiderUserId().equals(userId)) {
        latest = member;
      }
    }
    return latest;
  }

  private static DepartureDto departure(SharedRide shared) {
    return new DepartureDto(
        shared.getDepartureMode(), shared.getDepartureAt(), shared.getExpiresAt());
  }

  /**
   * The scheduled extension of a ride (scheduled-shared-v1 ScheduledInfo): claim state, and the
   * claiming driver for the rider while the ride is not live yet.
   *
   * @param ride a ride of kind scheduled
   * @param audience who looks
   * @return the block, or null when the extension row is missing
   */
  public ScheduledInfoDto scheduledInfo(Ride ride, Audience audience) {
    return scheduledRideRepository
        .findById(ride.getId())
        .map(
            scheduled -> {
              String claimState;
              if (scheduled.getConvertedAt() != null) {
                claimState = "converted";
              } else if (scheduled.getFallbackAt() != null) {
                claimState = "fallen_back";
              } else if (scheduled.isClaimed()) {
                claimState = "claimed";
              } else {
                claimState = "open";
              }
              boolean pending = ride.getState() == RideState.SCHEDULED;
              return new ScheduledInfoDto(
                  scheduled.getScheduledAt(),
                  claimState,
                  scheduled.getClaimedAt(),
                  pending,
                  pending && scheduled.isClaimed() && audience != Audience.DRIVER
                      ? driverSummary(
                          scheduled.getClaimedDriverUserId(), scheduled.getClaimedVehicleId())
                      : null);
            })
        .orElse(null);
  }

  /**
   * An offer card for its driver (UC-D-06).
   *
   * @param ride the offered ride
   * @param offer the offer
   * @return the card
   */
  public RideOfferDto offer(Ride ride, RideOffer offer) {
    ServiceType serviceType = serviceTypeRepository.findById(ride.getServiceTypeId()).orElseThrow();
    return new RideOfferDto(
        offer.getId(),
        ride.getId(),
        offer.getOfferedAt(),
        offer.getExpiresAt(),
        place(ride.getPickup(), ride.getPickupLabel()),
        offer.getPickupDistanceM(),
        offer.getPickupEtaS(),
        place(ride.getDestination(), ride.getDestinationLabel()),
        stops(ride.getStops()),
        serviceType.getNameEn(),
        serviceType.getNameAr(),
        ride.getEstimateTotal(),
        ride.getCurrency(),
        ride.getSurgeMultiplier().compareTo(BigDecimal.ONE) > 0,
        ride.getPaymentMethod(),
        riderSummary(ride.getRiderUserId()),
        ride.getKind() == RideKind.SHARED
            ? sharedRideRepository
                .findById(ride.getId())
                .map(
                    shared ->
                        new SharedOfferInfoDto(
                            shared.getSeatsTaken(),
                            sharedRideMemberRepository
                                .findByRideIdAndStatusOrderByJoinedAtAsc(
                                    ride.getId(), SharedMemberStatus.JOINED)
                                .size()))
                .orElse(null)
            : null);
  }

  /**
   * The driver card a rider sees (UC-R-05 step 2).
   *
   * @param driverUserId the driver
   * @param vehicleId the ride's vehicle
   * @return the card
   */
  public DriverSummaryDto driverSummary(UUID driverUserId, UUID vehicleId) {
    User driver = userRepository.findById(driverUserId).orElseThrow();
    FileRefDto photo = onboardingAssembler.profilePhoto(driver);
    VehicleSummaryDto vehicle =
        vehicleId == null
            ? null
            : vehicleRepository.findById(vehicleId).map(this::vehicleSummary).orElse(null);
    return new DriverSummaryDto(
        firstName(driver.getName()),
        photo == null ? null : photo.url(),
        ratingService.exposedAverage(driverUserId, RideParty.DRIVER),
        vehicle);
  }

  /**
   * The rider card a driver sees (UC-D-06, UC-R-02 comfort preferences).
   *
   * @param riderUserId the rider
   * @return the card
   */
  public RiderSummaryDto riderSummary(UUID riderUserId) {
    User rider = userRepository.findById(riderUserId).orElseThrow();
    RiderPreference preference =
        riderPreferenceRepository
            .findById(riderUserId)
            .orElseGet(() -> RiderPreference.defaults(riderUserId));
    return new RiderSummaryDto(
        firstName(rider.getName()),
        ratingService.exposedAverage(riderUserId, RideParty.RIDER),
        new ComfortPreferencesDto(
            preference.getTemperature(), preference.getConversation(), preference.getMusic()));
  }

  /**
   * The stored fare as a view (PRC-04: never recomputed).
   *
   * @param fare the stored row
   * @return the view
   */
  public FinalFareDto finalFare(Fare fare) {
    return new FinalFareDto(
        fare.getDistanceM(),
        fare.getDurationS(),
        new FareComponentsDto(
            fare.getCurrency(),
            fare.getBaseFare(),
            fare.getDistanceFare(),
            fare.getTimeFare(),
            fare.getSurchargePercent(),
            fare.getSurchargeAmount(),
            fare.getSurgeMultiplier(),
            fare.getSurgeAmount(),
            fare.getWaitFare(),
            fare.getPickupFee(),
            fare.getMinimumFareAdjustment(),
            fare.getDiscount(),
            fare.getTotal()));
  }

  /**
   * The ride's stored estimate.
   *
   * @param ride the ride
   * @return the estimate
   */
  public EstimateDto estimate(Ride ride) {
    return new EstimateDto(
        ride.getEstimateDistanceM(),
        ride.getEstimateDurationS(),
        ride.isEstimateApproximate(),
        objectMapper.convertValue(ride.getEstimateComponents(), FareComponentsDto.class));
  }

  /**
   * Fare components as the JSON map stored on the ride.
   *
   * @param components the components
   * @return the map
   */
  public Map<String, Object> componentsMap(FareComponentsDto components) {
    return objectMapper.convertValue(
        components,
        objectMapper.getTypeFactory().constructMapType(Map.class, String.class, Object.class));
  }

  /**
   * One reached-state timestamp per state (RIDE-02).
   *
   * @param ride the ride
   * @return the timeline
   */
  public RideTimelineDto timeline(Ride ride) {
    return new RideTimelineDto(
        ride.getRequestedAt(),
        ride.getOfferingAt(),
        ride.getAcceptedAt(),
        ride.getDriverArrivedAt(),
        ride.getStartedAt(),
        ride.getCompletedAt(),
        ride.getCancelledAt(),
        ride.getNoDriverFoundAt());
  }

  /**
   * A stored point + label as a place.
   *
   * @param point the point
   * @param label the label (may be null)
   * @return the place
   */
  public PlaceDto place(Point point, String label) {
    return new PlaceDto(point.getY(), point.getX(), label);
  }

  /**
   * The stored stops as places.
   *
   * @param stops the JSON stops
   * @return the places, in order
   */
  public List<PlaceDto> stops(List<Map<String, Object>> stops) {
    List<PlaceDto> places = new ArrayList<>();
    if (stops != null) {
      for (Map<String, Object> stop : stops) {
        places.add(
            new PlaceDto(
                ((Number) stop.get("lat")).doubleValue(),
                ((Number) stop.get("lng")).doubleValue(),
                (String) stop.get("label")));
      }
    }
    return places;
  }

  /**
   * Places as the JSON stops stored on the ride.
   *
   * @param stops the places (may be null)
   * @return the JSON list
   */
  public List<Map<String, Object>> stopMaps(List<PlaceDto> stops) {
    List<Map<String, Object>> maps = new ArrayList<>();
    if (stops != null) {
      for (PlaceDto stop : stops) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("lat", stop.lat());
        map.put("lng", stop.lng());
        if (stop.label() != null) {
          map.put("label", stop.label());
        }
        maps.add(map);
      }
    }
    return maps;
  }

  /**
   * The first word of a display name (riders and drivers only ever see first names).
   *
   * @param name the full name
   * @return the first name
   */
  public static String firstName(String name) {
    String trimmed = name == null ? "" : name.trim();
    int space = trimmed.indexOf(' ');
    return space < 0 ? trimmed : trimmed.substring(0, space);
  }

  private Instant waitGraceEndsAt(Ride ride) {
    if (ride.getDriverArrivedAt() == null) {
      return null;
    }
    return ride.getDriverArrivedAt().plusSeconds(60L * waitGraceMinutes(ride.getRegionId()));
  }

  /**
   * The region's wait grace in minutes (SRS default 5).
   *
   * @param regionId the region
   * @return minutes
   */
  public int waitGraceMinutes(UUID regionId) {
    return regionRepository
        .findById(regionId)
        .map(Region::getWaitGraceMin)
        .orElse(DEFAULT_WAIT_GRACE_MIN);
  }

  private VehicleSummaryDto vehicleSummary(Vehicle vehicle) {
    String photoUrl =
        vehicle.getPhotoFileIds().isEmpty()
            ? null
            : onboardingAssembler.fileRef(vehicle.getPhotoFileIds().get(0)).url();
    return new VehicleSummaryDto(
        vehicle.getMake(), vehicle.getModel(), vehicle.getColor(), vehicle.getPlate(), photoUrl);
  }

  private static LatLngPointDto point(Point point) {
    return new LatLngPointDto(point.getY(), point.getX());
  }
}
