package com.labby.backend.service;

import com.labby.backend.config.MoneyProperties;
import com.labby.backend.dto.DriverBalanceEntryDto;
import com.labby.backend.enums.DriverLedgerType;
import com.labby.backend.enums.FloorStatus;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.model.DriverBalance;
import com.labby.backend.model.Region;
import com.labby.backend.repository.DriverBalanceRepository;
import com.labby.backend.repository.DriverLocationRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideRepository;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/**
 * The COM-03 floor rules shared by dispatch, the driver balance views and the ledger: the floor is
 * per region ({@code driver_balance_floor}, NULL = the SRS default −50) and is compared against the
 * driver's balance in that region's currency. Status {@code warning} within the configured margin
 * above the floor, {@code blocked} at/below. The driver's OPERATING region is the region of their
 * most recent online presence (latest location), falling back to their last ride's region.
 */
@Component
@RequiredArgsConstructor
public class MoneyFloors {

  /** SRS COM-03: the floor when the region sets none. */
  public static final BigDecimal DEFAULT_FLOOR = new BigDecimal("-50");

  private final DriverBalanceRepository driverBalanceRepository;
  private final DriverLocationRepository driverLocationRepository;
  private final RegionRepository regionRepository;
  private final RideRepository rideRepository;
  private final NotificationService notificationService;
  private final MoneyProperties moneyProperties;

  /**
   * The region's floor (COM-03).
   *
   * @param region the region
   * @return its floor, or the SRS default when unset
   */
  public BigDecimal floor(Region region) {
    return region.getDriverBalanceFloor() == null ? DEFAULT_FLOOR : region.getDriverBalanceFloor();
  }

  /**
   * The floor standing of a balance.
   *
   * @param balance the driver's balance in the floor's currency
   * @param floor the floor
   * @return blocked at/below the floor, warning within the margin above it, ok otherwise
   */
  public FloorStatus status(BigDecimal balance, BigDecimal floor) {
    if (balance.compareTo(floor) <= 0) {
      return FloorStatus.BLOCKED;
    }
    if (balance.compareTo(floor.add(moneyProperties.floorWarningMargin())) <= 0) {
      return FloorStatus.WARNING;
    }
    return FloorStatus.OK;
  }

  /**
   * The driver's balance in a currency (0 when no ledger entry exists yet).
   *
   * @param driverUserId the driver
   * @param currency the currency
   * @return the balance
   */
  public BigDecimal balance(UUID driverUserId, String currency) {
    return driverBalanceRepository
        .findByDriverUserIdAndCurrency(driverUserId, currency)
        .map(DriverBalance::getBalance)
        .orElse(BigDecimal.ZERO);
  }

  /**
   * The driver's operating region: the active region covering their latest position, else their
   * last ride's region.
   *
   * @param driverUserId the driver
   * @return the region, or empty when the driver was never located nor rode
   */
  public Optional<Region> operatingRegion(UUID driverUserId) {
    Optional<Region> byPresence =
        driverLocationRepository
            .findById(driverUserId)
            .flatMap(
                location ->
                    regionRepository
                        .findActiveRegionsCovering(
                            location.getPosition().getY(), location.getPosition().getX())
                        .stream()
                        .findFirst());
    if (byPresence.isPresent()) {
      return byPresence;
    }
    return rideRepository
        .findByDriverUserIdOrderByRequestedAtDesc(driverUserId, PageRequest.of(0, 1))
        .stream()
        .findFirst()
        .flatMap(ride -> regionRepository.findById(ride.getRegionId()));
  }

  /**
   * The floor that applies to the driver's balance in a currency: the operating region's floor when
   * its currency matches, else the SRS default.
   *
   * @param driverUserId the driver
   * @param currency the balance currency
   * @return the floor
   */
  public BigDecimal floorFor(UUID driverUserId, String currency) {
    return floorFor(operatingRegion(driverUserId).orElse(null), currency);
  }

  private BigDecimal floorFor(Region operatingRegion, String currency) {
    if (operatingRegion != null && currency.equals(operatingRegion.getCurrency())) {
      return floor(operatingRegion);
    }
    return DEFAULT_FLOOR;
  }

  /**
   * The driver's per-currency balance entries with floor standing (money-v1 DriverBalanceEntry).
   *
   * @param driverUserId the driver
   * @return the entries, by currency
   */
  public List<DriverBalanceEntryDto> balanceEntries(UUID driverUserId) {
    Region operatingRegion = operatingRegion(driverUserId).orElse(null);
    return driverBalanceRepository.findByDriverUserIdOrderByCurrencyAsc(driverUserId).stream()
        .map(
            balance -> {
              BigDecimal floor = floorFor(operatingRegion, balance.getCurrency());
              return new DriverBalanceEntryDto(
                  balance.getCurrency(),
                  balance.getBalance(),
                  floor,
                  status(balance.getBalance(), floor));
            })
        .toList();
  }

  /**
   * Queues the COM-03 notifications a balance change crossed into: {@code warning} when entering
   * the margin, {@code blocked} at/below the floor, {@code unblocked} when a settlement pay-in
   * lifts the balance back above it (UC-A-27).
   *
   * @param driverUserId the driver
   * @param currency the entry's currency
   * @param before the balance before the entry
   * @param after the balance after it
   * @param type the ledger entry type
   */
  public void notifyTransition(
      UUID driverUserId,
      String currency,
      BigDecimal before,
      BigDecimal after,
      DriverLedgerType type) {
    BigDecimal floor = floorFor(driverUserId, currency);
    FloorStatus was = status(before, floor);
    FloorStatus now = status(after, floor);
    if (now == was) {
      return;
    }
    if (now == FloorStatus.BLOCKED) {
      notificationService.queue(
          driverUserId,
          NotificationEvent.DRIVER_BALANCE_BLOCKED,
          Map.of(
              "balance", after.toPlainString(),
              "floor", floor.toPlainString(),
              "currency", currency));
    } else if (now == FloorStatus.WARNING && was == FloorStatus.OK) {
      notificationService.queue(
          driverUserId,
          NotificationEvent.DRIVER_BALANCE_WARNING,
          Map.of(
              "balance", after.toPlainString(),
              "floor", floor.toPlainString(),
              "currency", currency));
    } else if (was == FloorStatus.BLOCKED && type == DriverLedgerType.SETTLEMENT_PAY_IN) {
      notificationService.queue(
          driverUserId,
          NotificationEvent.DRIVER_BALANCE_UNBLOCKED,
          Map.of("balance", after.toPlainString(), "currency", currency));
    }
  }
}
