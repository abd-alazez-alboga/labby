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
import com.labby.backend.repository.RideRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
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
 * attached; the summary totals the operating region's currency over the period; the balance view
 * evaluates each currency against the operating region's floor.
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
          DriverLedgerType.BONUS);

  private final RideAccess rideAccess;
  private final DriverLedgerRepository driverLedgerRepository;
  private final RideRepository rideRepository;
  private final MoneyFloors moneyFloors;
  private final CommissionService commissionService;
  private final Clock clock;

  @Override
  public TripEarningPageDto earnings(UUID driverUserId, int page, int size) {
    rideAccess.requireDriver(driverUserId);
    Page<DriverLedgerEntry> anchors =
        driverLedgerRepository.findByDriverUserIdAndTypeInOrderByCreatedAtDescIdDesc(
            driverUserId, TRIP_ANCHORS, PageRequest.of(page, size));
    List<UUID> rideIds = anchors.getContent().stream().map(DriverLedgerEntry::getRideId).toList();
    Map<UUID, Ride> rides =
        rideRepository.findAllById(rideIds).stream()
            .collect(Collectors.toMap(Ride::getId, Function.identity()));
    Map<UUID, DriverLedgerEntry> tips =
        rideIds.isEmpty()
            ? Map.of()
            : driverLedgerRepository
                .findByDriverUserIdAndTypeAndRideIdIn(driverUserId, DriverLedgerType.TIP, rideIds)
                .stream()
                .collect(Collectors.toMap(DriverLedgerEntry::getRideId, Function.identity()));
    return new TripEarningPageDto(
        anchors.getContent().stream()
            .map(anchor -> toTrip(anchor, rides.get(anchor.getRideId()), tips))
            .toList(),
        anchors.getNumber(),
        anchors.getSize(),
        anchors.getTotalElements(),
        anchors.getTotalPages());
  }

  private TripEarningDto toTrip(
      DriverLedgerEntry anchor, Ride ride, Map<UUID, DriverLedgerEntry> tips) {
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
          anchor.getAmount());
    }
    DriverLedgerEntry tip = tips.get(anchor.getRideId());
    BigDecimal tipAmount = tip == null ? null : tip.getAmount();
    BigDecimal net = tipAmount == null ? anchor.getAmount() : anchor.getAmount().add(tipAmount);
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
        net);
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
    int trips = 0;
    BigDecimal fares = BigDecimal.ZERO;
    BigDecimal commission = BigDecimal.ZERO;
    BigDecimal tips = BigDecimal.ZERO;
    BigDecimal net = BigDecimal.ZERO;
    for (DriverLedgerEntry entry : entries) {
      net = net.add(entry.getAmount());
      if (FARE_TYPES.contains(entry.getType())) {
        trips++;
        fares = fares.add(entry.getFareAmount());
        commission = commission.add(entry.getCommissionAmount());
      } else if (entry.getType() == DriverLedgerType.TIP) {
        tips = tips.add(entry.getAmount());
      }
    }
    return new EarningsSummaryDto(
        period, from, to, region.getCurrency(), trips, fares, commission, tips, net);
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
