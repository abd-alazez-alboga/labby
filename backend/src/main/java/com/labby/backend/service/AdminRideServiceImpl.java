package com.labby.backend.service;

import com.labby.backend.dto.AdminRideDetailDto;
import com.labby.backend.dto.AdminRideSummaryDto;
import com.labby.backend.dto.AdminRideSummaryPageDto;
import com.labby.backend.dto.OfferTrailEntryDto;
import com.labby.backend.dto.TracePointDto;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Fare;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.ServiceType;
import com.labby.backend.model.User;
import com.labby.backend.repository.FareRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideOfferRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RideTraceRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.service.RideAssembler.Audience;
import jakarta.persistence.criteria.Predicate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read-only; an unknown phone matches no ride (an empty page, never an error). */
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class AdminRideServiceImpl implements AdminRideService {

  private final RideRepository rideRepository;
  private final RideOfferRepository rideOfferRepository;
  private final RideTraceRepository rideTraceRepository;
  private final FareRepository fareRepository;
  private final RegionRepository regionRepository;
  private final ServiceTypeRepository serviceTypeRepository;
  private final UserRepository userRepository;
  private final RideAssembler rideAssembler;

  @Override
  public AdminRideSummaryPageDto search(Filter filter, int page, int size) {
    Optional<UUID> party = Optional.ofNullable(filter.userId());
    if (filter.phone() != null && !filter.phone().isBlank()) {
      Optional<UUID> byPhone = userRepository.findByPhone(filter.phone().trim()).map(User::getId);
      if (byPhone.isEmpty() || (party.isPresent() && !party.get().equals(byPhone.get()))) {
        return new AdminRideSummaryPageDto(List.of(), page, size, 0);
      }
      party = byPhone;
    }
    UUID partyId = party.orElse(null);
    Specification<Ride> spec =
        (root, query, builder) -> {
          List<Predicate> predicates = new ArrayList<>();
          if (filter.regionId() != null) {
            predicates.add(builder.equal(root.get("regionId"), filter.regionId()));
          }
          if (filter.state() != null) {
            predicates.add(builder.equal(root.get("state"), filter.state()));
          }
          if (filter.kind() != null) {
            predicates.add(builder.equal(root.get("kind"), filter.kind()));
          }
          if (partyId != null) {
            predicates.add(
                builder.or(
                    builder.equal(root.get("riderUserId"), partyId),
                    builder.equal(root.get("driverUserId"), partyId)));
          }
          if (filter.from() != null) {
            predicates.add(builder.greaterThanOrEqualTo(root.get("requestedAt"), filter.from()));
          }
          if (filter.to() != null) {
            predicates.add(builder.lessThan(root.get("requestedAt"), filter.to()));
          }
          return builder.and(predicates.toArray(Predicate[]::new));
        };
    Page<Ride> rides =
        rideRepository.findAll(
            spec, PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "requestedAt")));
    Map<UUID, Fare> fares =
        fareRepository
            .findByRideIdIn(rides.getContent().stream().map(Ride::getId).toList())
            .stream()
            .collect(Collectors.toMap(Fare::getRideId, Function.identity()));
    return new AdminRideSummaryPageDto(
        rides.getContent().stream().map(ride -> row(ride, fares.get(ride.getId()))).toList(),
        rides.getNumber(),
        rides.getSize(),
        rides.getTotalElements());
  }

  @Override
  public AdminRideDetailDto detail(UUID rideId) {
    Ride ride =
        rideRepository
            .findById(rideId)
            .orElseThrow(() -> new ResourceNotFoundException("Ride not found"));
    User rider = userRepository.findById(ride.getRiderUserId()).orElseThrow();
    Optional<User> driver =
        Optional.ofNullable(ride.getDriverUserId()).flatMap(userRepository::findById);
    List<OfferTrailEntryDto> offers =
        rideOfferRepository.findByRideIdOrderBySequenceAsc(rideId).stream()
            .map(
                offer ->
                    new OfferTrailEntryDto(
                        offer.getId(),
                        offer.getSequence(),
                        offer.getDriverUserId(),
                        userRepository
                            .findById(offer.getDriverUserId())
                            .map(User::getName)
                            .orElse(""),
                        offer.getVehicleId(),
                        offer.getOfferedAt(),
                        offer.getExpiresAt(),
                        offer.getResponse(),
                        offer.getRespondedAt(),
                        offer.getPickupDistanceM(),
                        offer.getPickupEtaS()))
            .toList();
    List<TracePointDto> trace =
        rideTraceRepository.findByRideIdOrderByRecordedAtAscIdAsc(rideId).stream()
            .map(
                point ->
                    new TracePointDto(
                        point.getPosition().getY(),
                        point.getPosition().getX(),
                        point.getRecordedAt(),
                        point.getPhase()))
            .toList();
    return new AdminRideDetailDto(
        rideAssembler.view(ride, Audience.ADMIN),
        rider.getId(),
        rider.getName(),
        rider.getPhone(),
        driver.map(User::getId).orElse(null),
        driver.map(User::getName).orElse(null),
        driver.map(User::getPhone).orElse(null),
        ride.getVehicleId(),
        ride.getCancellationNote(),
        offers,
        trace);
  }

  private AdminRideSummaryDto row(Ride ride, Fare fare) {
    ServiceType serviceType = serviceTypeRepository.findById(ride.getServiceTypeId()).orElseThrow();
    String regionName =
        regionRepository.findById(ride.getRegionId()).map(Region::getName).orElse("");
    return new AdminRideSummaryDto(
        ride.getId(),
        ride.getState(),
        ride.getRequestedAt(),
        rideAssembler.place(ride.getPickup(), ride.getPickupLabel()),
        rideAssembler.place(ride.getDestination(), ride.getDestinationLabel()),
        serviceType.getNameEn(),
        serviceType.getNameAr(),
        fare == null ? null : fare.getTotal(),
        ride.getCancellationFee(),
        ride.getCurrency(),
        ride.getKind(),
        ride.getRegionId(),
        regionName,
        ride.getRiderUserId(),
        userRepository.findById(ride.getRiderUserId()).map(User::getName).orElse(""),
        ride.getDriverUserId(),
        ride.getDriverUserId() == null
            ? null
            : userRepository.findById(ride.getDriverUserId()).map(User::getName).orElse(null));
  }
}
