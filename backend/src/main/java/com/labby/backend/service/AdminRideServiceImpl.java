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
import com.labby.backend.util.PhoneNumbers;
import jakarta.persistence.criteria.Predicate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
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

  /** Newest first; the id breaks ties so pages and exports share one stable order. */
  private static final Sort ORDER = Sort.by(Sort.Order.desc("requestedAt"), Sort.Order.desc("id"));

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
    Optional<Specification<Ride>> spec = spec(filter);
    if (spec.isEmpty()) {
      return new AdminRideSummaryPageDto(List.of(), page, size, 0);
    }
    Page<Ride> rides = rideRepository.findAll(spec.get(), PageRequest.of(page, size, ORDER));
    return new AdminRideSummaryPageDto(
        rows(rides.getContent()), rides.getNumber(), rides.getSize(), rides.getTotalElements());
  }

  @Override
  public List<AdminRideSummaryDto> searchAll(Filter filter, int maxRows) {
    Optional<Specification<Ride>> spec = spec(filter);
    if (spec.isEmpty()) {
      return List.of();
    }
    ExportLimits.check(rideRepository.count(spec.get()), maxRows);
    return rows(rideRepository.findAll(spec.get(), PageRequest.of(0, maxRows, ORDER)).getContent());
  }

  /** The search predicate; empty when the phone filter matches no account (no ride can match). */
  private Optional<Specification<Ride>> spec(Filter filter) {
    Optional<UUID> party = Optional.ofNullable(filter.userId());
    if (filter.phone() != null && !filter.phone().isBlank()) {
      Optional<UUID> byPhone =
          userRepository
              // Any typed form finds the account (E.164 canonical storage, owner 2026-10-20).
              .findByPhone(PhoneNumbers.normalize(filter.phone().trim()))
              .map(User::getId);
      if (byPhone.isEmpty() || (party.isPresent() && !party.get().equals(byPhone.get()))) {
        return Optional.empty();
      }
      party = byPhone;
    }
    UUID partyId = party.orElse(null);
    return Optional.of(
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
        });
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

  /** Search rows with every lookup batched (an export may hold thousands of rides). */
  private List<AdminRideSummaryDto> rows(List<Ride> rides) {
    Map<UUID, Fare> fares =
        fareRepository.findByRideIdIn(rides.stream().map(Ride::getId).toList()).stream()
            .collect(Collectors.toMap(Fare::getRideId, Function.identity()));
    Map<UUID, ServiceType> serviceTypes =
        byId(
            serviceTypeRepository.findAllById(
                rides.stream().map(Ride::getServiceTypeId).collect(Collectors.toSet())),
            ServiceType::getId);
    Map<UUID, Region> regions =
        byId(
            regionRepository.findAllById(
                rides.stream().map(Ride::getRegionId).collect(Collectors.toSet())),
            Region::getId);
    Set<UUID> partyIds = new HashSet<>();
    rides.forEach(
        ride -> {
          partyIds.add(ride.getRiderUserId());
          if (ride.getDriverUserId() != null) {
            partyIds.add(ride.getDriverUserId());
          }
        });
    Map<UUID, User> users = byId(userRepository.findAllById(partyIds), User::getId);
    return rides.stream()
        .map(
            ride -> {
              ServiceType serviceType = serviceTypes.get(ride.getServiceTypeId());
              Fare fare = fares.get(ride.getId());
              User rider = users.get(ride.getRiderUserId());
              User driver =
                  ride.getDriverUserId() == null ? null : users.get(ride.getDriverUserId());
              Region region = regions.get(ride.getRegionId());
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
                  region == null ? "" : region.getName(),
                  ride.getRiderUserId(),
                  rider == null ? "" : rider.getName(),
                  ride.getDriverUserId(),
                  driver == null ? null : driver.getName());
            })
        .toList();
  }

  private static <T> Map<UUID, T> byId(Iterable<T> items, Function<T, UUID> id) {
    Map<UUID, T> map = new HashMap<>();
    items.forEach(item -> map.put(id.apply(item), item));
    return map;
  }
}
