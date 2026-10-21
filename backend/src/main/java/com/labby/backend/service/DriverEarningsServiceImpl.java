package com.labby.backend.service;

import com.labby.backend.dto.DriverBalanceViewDto;
import com.labby.backend.dto.EarningsSummaryDto;
import com.labby.backend.dto.TripEarningDto;
import com.labby.backend.dto.TripEarningDto.TripReportDto;
import com.labby.backend.dto.TripEarningPageDto;
import com.labby.backend.enums.DriverLedgerType;
import com.labby.backend.enums.PaymentMethod;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.SharedMemberStatus;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.DriverLedgerEntry;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.ServiceType;
import com.labby.backend.model.SharedRideMember;
import com.labby.backend.model.User;
import com.labby.backend.repository.DriverLedgerRepository;
import com.labby.backend.repository.DriverTripRepository;
import com.labby.backend.repository.DriverTripRepository.DriverReport;
import com.labby.backend.repository.DriverTripRepository.TripRow;
import com.labby.backend.repository.PromoRedemptionRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import com.labby.backend.repository.SharedRideMemberRepository;
import com.labby.backend.repository.UserRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * UC-D-15/16 views built from the ledger: the earnings page anchors on one entry per ride (the
 * COM-01 fare posting, or the collected cancellation-fee credit of a cancelled ride) with its tip
 * and its M13 promo compensation attached — plus (V1 conformance W43) every ride the driver
 * accepted that was later cancelled without such an entry, so any past trip can be opened and its
 * rider reported; the summary totals the operating region's currency over the period; the balance
 * view evaluates each currency against the operating region's floor.
 */
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class DriverEarningsServiceImpl implements DriverEarningsService {

  private static final List<DriverLedgerType> TRIP_ANCHORS =
      List.of(
          DriverLedgerType.RIDE_EARNING,
          DriverLedgerType.COMMISSION_DUE,
          DriverLedgerType.CANCELLATION_FEE);

  private static final EnumSet<DriverLedgerType> FARE_TYPES =
      EnumSet.of(DriverLedgerType.RIDE_EARNING, DriverLedgerType.COMMISSION_DUE);

  private static final List<DriverLedgerType> SUMMARY_TYPES =
      List.of(
          DriverLedgerType.RIDE_EARNING,
          DriverLedgerType.COMMISSION_DUE,
          DriverLedgerType.TIP,
          DriverLedgerType.CANCELLATION_FEE,
          DriverLedgerType.DUE_COLLECTION,
          DriverLedgerType.BONUS,
          DriverLedgerType.PROMO_COMPENSATION);

  private final RideAccess rideAccess;
  private final DriverLedgerRepository driverLedgerRepository;
  private final RideRepository rideRepository;
  private final PromoRedemptionRepository promoRedemptionRepository;
  private final SharedRideMemberRepository sharedRideMemberRepository;
  private final DriverTripRepository driverTripRepository;
  private final UserRepository userRepository;
  private final ServiceTypeRepository serviceTypeRepository;
  private final MoneyFloors moneyFloors;
  private final CommissionService commissionService;
  private final RideAssembler rideAssembler;
  private final RideLifecycle rideLifecycle;
  private final Clock clock;

  @Override
  public TripEarningPageDto earnings(UUID driverUserId, int page, int size) {
    rideAccess.requireDriver(driverUserId);
    long total = driverTripRepository.count(driverUserId);
    List<TripRow> rows = driverTripRepository.page(driverUserId, size, (long) page * size);
    return new TripEarningPageDto(
        toTrips(driverUserId, rows, false), page, size, total, (int) ((total + size - 1) / size));
  }

  @Override
  public TripEarningDto trip(UUID driverUserId, UUID rideId, UUID memberId) {
    rideAccess.requireDriver(driverUserId);
    List<TripRow> rows =
        driverTripRepository.ofRide(driverUserId, rideId).stream()
            .filter(row -> memberId == null || memberId.equals(row.memberId()))
            .toList();
    if (rows.isEmpty()) {
      throw new ResourceNotFoundException("Trip not found");
    }
    if (rows.stream().map(TripRow::memberId).distinct().count() > 1) {
      throw (InvalidRequestException)
          new InvalidRequestException("memberId is required on a shared ride")
              .withCode("member_required");
    }
    return toTrips(driverUserId, List.of(rows.get(0)), true).get(0);
  }

  /**
   * Builds the rows with one query per related table (never per row). With {@code detail} (one
   * row), a completed trip also carries its route map: pickup, drop-off and the in_ride trace.
   */
  private List<TripEarningDto> toTrips(UUID driverUserId, List<TripRow> rows, boolean detail) {
    if (rows.isEmpty()) {
      return List.of();
    }
    Map<UUID, DriverLedgerEntry> anchors =
        driverLedgerRepository
            .findAllById(rows.stream().map(TripRow::anchorId).filter(Objects::nonNull).toList())
            .stream()
            .collect(Collectors.toMap(DriverLedgerEntry::getId, Function.identity()));
    List<UUID> rideIds = rows.stream().map(TripRow::rideId).distinct().toList();
    Map<UUID, Ride> rides =
        rideRepository.findAllById(rideIds).stream()
            .collect(Collectors.toMap(Ride::getId, Function.identity()));
    // V1 audit H6: a shared ride holds one tip per member and its fare anchors are per member, so
    // tips and the promo compensation are keyed by (ride, member) — each lands on its own share.
    Map<AnchorKey, DriverLedgerEntry> tips = byAnchor(driverUserId, DriverLedgerType.TIP, rideIds);
    // M13 ruling 1: the platform-funded promo discount rides on the trip row (one per ride, V25).
    Map<AnchorKey, DriverLedgerEntry> compensations =
        byAnchor(driverUserId, DriverLedgerType.PROMO_COMPENSATION, rideIds);
    attachLegacySharedCompensations(compensations);
    Map<UUID, SharedRideMember> members =
        sharedRideMemberRepository
            .findAllById(rows.stream().map(TripRow::memberId).filter(Objects::nonNull).toList())
            .stream()
            .collect(Collectors.toMap(SharedRideMember::getId, Function.identity()));
    Map<UUID, String> names =
        userRepository
            .findAllById(
                rows.stream()
                    .map(row -> riderOf(row, rides.get(row.rideId()), members))
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet()))
            .stream()
            .collect(
                Collectors.toMap(User::getId, user -> RideAssembler.firstName(user.getName())));
    Map<UUID, ServiceType> serviceTypes =
        serviceTypeRepository
            .findAllById(rides.values().stream().map(Ride::getServiceTypeId).distinct().toList())
            .stream()
            .collect(Collectors.toMap(ServiceType::getId, Function.identity()));
    Map<ReportKey, DriverReport> reports = new HashMap<>();
    for (DriverReport report : driverTripRepository.reportsOn(driverUserId, rideIds)) {
      reports.put(new ReportKey(report.rideId(), report.reportedUserId()), report);
    }
    return rows.stream()
        .map(
            row -> {
              Ride ride = rides.get(row.rideId());
              SharedRideMember member = row.memberId() == null ? null : members.get(row.memberId());
              UUID riderUserId = riderOf(row, ride, members);
              DriverReport report =
                  riderUserId == null
                      ? null
                      : reports.get(new ReportKey(ride.getId(), riderUserId));
              DriverLedgerEntry anchor =
                  row.anchorId() == null ? null : anchors.get(row.anchorId());
              Money money =
                  anchor == null
                      ? Money.none(row, ride, member)
                      : money(anchor, ride, tips, compensations);
              ServiceType serviceType = serviceTypes.get(ride.getServiceTypeId());
              boolean reportable =
                  report == null
                      && riderUserId != null
                      && (ride.getKind() != RideKind.SHARED || member != null);
              TripEarningDto trip =
                  new TripEarningDto(
                      ride.getId(),
                      money.at(),
                      money.currency(),
                      money.fareTotal(),
                      money.paymentMethod(),
                      money.commissionRate(),
                      money.commissionAmount(),
                      money.tip(),
                      money.cancellationFee(),
                      money.promoCompensation(),
                      money.net(),
                      row.memberId(),
                      ride.getState(),
                      ride.getKind(),
                      riderUserId == null ? null : names.get(riderUserId),
                      ride.getPickupLabel(),
                      ride.getDestinationLabel(),
                      serviceType == null ? null : serviceType.getNameEn(),
                      serviceType == null ? null : serviceType.getNameAr(),
                      ride.getAcceptedAt(),
                      ride.getStartedAt(),
                      ride.getCancelledAt(),
                      member != null && member.getCancellationReason() != null
                          ? member.getCancellationReason()
                          : ride.getCancellationReason(),
                      member != null ? member.getCancellationFee() : ride.getCancellationFee(),
                      report == null
                          ? null
                          : new TripReportDto(
                              report.reportId(),
                              report.category(),
                              report.status(),
                              report.createdAt()),
                      reportable,
                      null,
                      null,
                      null);
              return detail && completed(ride, member) ? withMap(trip, ride) : trip;
            })
        .toList();
  }

  /** A completed ride — and, on a shared ride, a member who rode it to the end. */
  private static boolean completed(Ride ride, SharedRideMember member) {
    return ride.getState() == RideState.COMPLETED
        && (member == null || member.getStatus() == SharedMemberStatus.COMPLETED);
  }

  /** Board V1FDriverTripDetail: the route map, built like the rider receipt's (UC-R-07). */
  private TripEarningDto withMap(TripEarningDto trip, Ride ride) {
    return trip.withMap(
        rideAssembler.place(ride.getPickup(), ride.getPickupLabel()),
        rideAssembler.place(ride.getDestination(), ride.getDestinationLabel()),
        rideLifecycle.inRideLine(ride.getId()));
  }

  /** The rider a row is about: the member's rider on a shared ride, else the ride's rider. */
  private static UUID riderOf(TripRow row, Ride ride, Map<UUID, SharedRideMember> members) {
    if (row.memberId() != null && members.containsKey(row.memberId())) {
      return members.get(row.memberId()).getRiderUserId();
    }
    return ride.getKind() == RideKind.SHARED ? null : ride.getRiderUserId();
  }

  /** The driver's report on one rider of one ride (REP-01: at most one). */
  private record ReportKey(UUID rideId, UUID reportedUserId) {}

  /** The money fields of one row. */
  private record Money(
      Instant at,
      String currency,
      BigDecimal fareTotal,
      PaymentMethod paymentMethod,
      BigDecimal commissionRate,
      BigDecimal commissionAmount,
      BigDecimal tip,
      BigDecimal cancellationFee,
      BigDecimal promoCompensation,
      BigDecimal net) {

    /** W43: a ride cancelled after acceptance that moved no money for the driver. */
    static Money none(TripRow row, Ride ride, SharedRideMember member) {
      BigDecimal zero = BigDecimal.ZERO.setScale(2);
      return new Money(
          row.at(),
          ride.getCurrency(),
          zero,
          member != null ? member.getPaymentMethod() : ride.getPaymentMethod(),
          zero,
          zero,
          null,
          null,
          null,
          zero);
    }
  }

  private Map<AnchorKey, DriverLedgerEntry> byAnchor(
      UUID driverUserId, DriverLedgerType type, List<UUID> rideIds) {
    if (rideIds.isEmpty()) {
      return new HashMap<>();
    }
    Map<AnchorKey, DriverLedgerEntry> entries = new HashMap<>();
    for (DriverLedgerEntry entry :
        driverLedgerRepository.findByDriverUserIdAndTypeAndRideIdIn(driverUserId, type, rideIds)) {
      entries.putIfAbsent(AnchorKey.of(entry), entry);
    }
    return entries;
  }

  /**
   * A shared ride's compensation posted before the member attribution (V1 audit H6) carries no
   * member: it belongs to the share of the member who redeemed the promo, so it is re-keyed to that
   * member's anchor — attached once, never to every share.
   */
  private void attachLegacySharedCompensations(Map<AnchorKey, DriverLedgerEntry> compensations) {
    for (DriverLedgerEntry legacy : List.copyOf(compensations.values())) {
      if (legacy.getSharedRideMemberId() != null) {
        continue;
      }
      promoRedemptionRepository
          .findByRideId(legacy.getRideId())
          .flatMap(
              redemption ->
                  sharedRideMemberRepository.findFirstByRideIdAndRiderUserIdOrderByJoinedAtDesc(
                      legacy.getRideId(), redemption.getUserId()))
          .ifPresent(
              member -> {
                compensations.remove(AnchorKey.of(legacy));
                compensations.put(new AnchorKey(legacy.getRideId(), member.getId()), legacy);
              });
    }
  }

  private Money money(
      DriverLedgerEntry anchor,
      Ride ride,
      Map<AnchorKey, DriverLedgerEntry> tips,
      Map<AnchorKey, DriverLedgerEntry> compensations) {
    BigDecimal zero = BigDecimal.ZERO.setScale(2);
    if (!FARE_TYPES.contains(anchor.getType())) {
      // A cancelled ride whose fee was credited to this driver: no fare, no commission.
      return new Money(
          anchor.getCreatedAt(),
          anchor.getCurrency(),
          zero,
          ride.getPaymentMethod(),
          zero,
          zero,
          null,
          anchor.getAmount(),
          null,
          anchor.getAmount());
    }
    DriverLedgerEntry tip = tips.get(AnchorKey.of(anchor));
    BigDecimal tipAmount = tip == null ? null : tip.getAmount();
    DriverLedgerEntry compensation = compensations.get(AnchorKey.of(anchor));
    BigDecimal compensationAmount = compensation == null ? null : compensation.getAmount();
    BigDecimal net = anchor.getAmount();
    if (tipAmount != null) {
      net = net.add(tipAmount);
    }
    if (compensationAmount != null) {
      net = net.add(compensationAmount);
    }
    return new Money(
        ride.getCompletedAt(),
        anchor.getCurrency(),
        anchor.getFareAmount(),
        ride.getPaymentMethod(),
        anchor.getCommissionRate(),
        anchor.getCommissionAmount(),
        tipAmount,
        null,
        compensationAmount,
        net);
  }

  /**
   * One trip row's attribution: the ride, and the shared-ride member (null on a non-shared ride).
   *
   * @param rideId the ride
   * @param memberId the shared-ride member, or null
   */
  private record AnchorKey(UUID rideId, UUID memberId) {

    static AnchorKey of(DriverLedgerEntry entry) {
      return new AnchorKey(entry.getRideId(), entry.getSharedRideMemberId());
    }
  }

  @Override
  public EarningsSummaryDto summary(UUID driverUserId, String period, LocalDate anchor) {
    rideAccess.requireDriver(driverUserId);
    Region region =
        moneyFloors
            .operatingRegion(driverUserId)
            .orElseThrow(() -> new ResourceNotFoundException("No operating region yet"));
    ZoneId zone = ZoneId.of(region.getTimeZone());
    LocalDate anchorDate = anchor == null ? LocalDate.ofInstant(clock.instant(), zone) : anchor;
    boolean weekly = "weekly".equals(period);
    LocalDate from = weekly ? anchorDate.with(DayOfWeek.MONDAY) : anchorDate.withDayOfMonth(1);
    LocalDate to = weekly ? from.plusDays(6) : anchorDate.with(TemporalAdjusters.lastDayOfMonth());
    List<DriverLedgerEntry> entries =
        driverLedgerRepository
            .findByDriverUserIdAndCurrencyAndTypeInAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                driverUserId,
                region.getCurrency(),
                SUMMARY_TYPES,
                from.atStartOfDay(zone).toInstant(),
                to.plusDays(1).atStartOfDay(zone).toInstant());
    // V1 audit H6 (incentives Q5): a shared ride is ONE trip, however many member fare entries.
    Set<UUID> tripRides = new HashSet<>();
    BigDecimal fares = BigDecimal.ZERO;
    BigDecimal commission = BigDecimal.ZERO;
    BigDecimal tips = BigDecimal.ZERO;
    BigDecimal net = BigDecimal.ZERO;
    for (DriverLedgerEntry entry : entries) {
      net = net.add(entry.getAmount());
      if (FARE_TYPES.contains(entry.getType())) {
        tripRides.add(entry.getRideId());
        fares = fares.add(entry.getFareAmount());
        commission = commission.add(entry.getCommissionAmount());
      } else if (entry.getType() == DriverLedgerType.TIP) {
        tips = tips.add(entry.getAmount());
      }
    }
    return new EarningsSummaryDto(
        period, from, to, region.getCurrency(), tripRides.size(), fares, commission, tips, net);
  }

  @Override
  public DriverBalanceViewDto balance(UUID driverUserId) {
    rideAccess.requireDriver(driverUserId);
    return new DriverBalanceViewDto(
        moneyFloors.balanceEntries(driverUserId),
        moneyFloors
            .operatingRegion(driverUserId)
            .map(region -> commissionService.status(driverUserId, region, clock.instant()))
            .orElse(null));
  }
}
