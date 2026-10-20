package com.labby.backend.service;

import com.labby.backend.dto.DriverBalanceViewDto;
import com.labby.backend.dto.EarningsSummaryDto;
import com.labby.backend.dto.TripEarningDto;
import com.labby.backend.dto.TripEarningPageDto;
import com.labby.backend.enums.DriverLedgerType;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.DriverLedgerEntry;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.repository.DriverLedgerRepository;
import com.labby.backend.repository.PromoRedemptionRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.SharedRideMemberRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * UC-D-15/16 views built from the ledger: the earnings page anchors on one entry per ride (the
 * COM-01 fare posting, or the collected cancellation-fee credit of a cancelled ride) with its tip
 * and its M13 promo compensation attached; the summary totals the operating region's currency over
 * the period; the balance view evaluates each currency against the operating region's floor.
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
  private final MoneyFloors moneyFloors;
  private final CommissionService commissionService;
  private final Clock clock;

  @Override
  public TripEarningPageDto earnings(UUID driverUserId, int page, int size) {
    rideAccess.requireDriver(driverUserId);
    Page<DriverLedgerEntry> anchors =
        driverLedgerRepository.findByDriverUserIdAndTypeInOrderByCreatedAtDescIdDesc(
            driverUserId, TRIP_ANCHORS, PageRequest.of(page, size));
    List<UUID> rideIds =
        anchors.getContent().stream().map(DriverLedgerEntry::getRideId).distinct().toList();
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
    return new TripEarningPageDto(
        anchors.getContent().stream()
            .map(anchor -> toTrip(anchor, rides.get(anchor.getRideId()), tips, compensations))
            .toList(),
        anchors.getNumber(),
        anchors.getSize(),
        anchors.getTotalElements(),
        anchors.getTotalPages());
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

  private TripEarningDto toTrip(
      DriverLedgerEntry anchor,
      Ride ride,
      Map<AnchorKey, DriverLedgerEntry> tips,
      Map<AnchorKey, DriverLedgerEntry> compensations) {
    BigDecimal zero = BigDecimal.ZERO.setScale(2);
    if (!FARE_TYPES.contains(anchor.getType())) {
      // A cancelled ride whose fee was credited to this driver: no fare, no commission.
      return new TripEarningDto(
          anchor.getRideId(),
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
    return new TripEarningDto(
        anchor.getRideId(),
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
