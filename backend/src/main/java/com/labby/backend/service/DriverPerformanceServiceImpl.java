package com.labby.backend.service;

import com.labby.backend.dto.DriverPerformanceDto;
import com.labby.backend.dto.MetricWarningDto;
import com.labby.backend.dto.MetricWindowDto;
import com.labby.backend.dto.MoneyAmountDto;
import com.labby.backend.dto.OwnRatingAggregateDto;
import com.labby.backend.dto.PercentageDto;
import com.labby.backend.dto.RatingRuleDto;
import com.labby.backend.enums.DriverMetric;
import com.labby.backend.enums.FlagKind;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.RideParty;
import com.labby.backend.model.DriverMetricWarning;
import com.labby.backend.model.Region;
import com.labby.backend.repository.DriverLedgerRepository;
import com.labby.backend.repository.DriverMetricWarningRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideOfferRepository;
import com.labby.backend.repository.RideRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Driver metrics on read and the DRV-07 warning evaluation (see {@link DriverPerformanceService}).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class DriverPerformanceServiceImpl implements DriverPerformanceService {

  /** DRV-06: the dashboard's rolling windows. */
  static final List<Integer> WINDOWS = List.of(7, 30);

  /** The widest DRV-07 window a region may configure (7 or 30). */
  static final int MAX_WINDOW_DAYS = 30;

  private final RideAccess rideAccess;
  private final RideRepository rideRepository;
  private final RideOfferRepository rideOfferRepository;
  private final DriverLedgerRepository driverLedgerRepository;
  private final DriverMetricWarningRepository driverMetricWarningRepository;
  private final RegionRepository regionRepository;
  private final RatingService ratingService;
  private final AccountFlagService accountFlagService;
  private final NotificationService notificationService;
  private final Clock clock;

  @Override
  @Transactional(readOnly = true)
  public DriverPerformanceDto dashboard(UUID driverUserId) {
    rideAccess.requireDriver(driverUserId);
    Instant now = clock.instant();
    List<MetricWindowDto> windows = new ArrayList<>();
    for (int days : WINDOWS) {
      windows.add(window(driverUserId, days, now));
    }
    OwnRatingAggregateDto rating = ratingService.ownAggregate(driverUserId, RideParty.DRIVER);
    RatingRuleDto ratingRule =
        latestRegion(driverUserId)
            .map(
                region -> {
                  TrustRules.RatingRule rule =
                      TrustRules.ratingRule(region.getSuspensionThresholds(), RideParty.DRIVER);
                  return new RatingRuleDto(
                      rule.minAvgRating(), rule.minRatedRides(), rule.warnAvgRating());
                })
            .orElse(null);
    // UC-D-20 A1: the EXPOSED (snapshot) average against the region's warning level.
    boolean ratingWarning =
        ratingRule != null
            && rating.average() != null
            && rating.average().compareTo(ratingRule.warnAvgRating()) < 0;
    return new DriverPerformanceDto(
        windows, rating, activeWarnings(driverUserId), ratingRule, ratingWarning);
  }

  private MetricWindowDto window(UUID driverUserId, int days, Instant now) {
    Instant from = now.minus(Duration.ofDays(days));
    RideOfferRepository.OfferCounts offers =
        rideOfferRepository.offerCounts(driverUserId, from, now);
    RideRepository.DriverRideMetrics rides =
        rideRepository.driverRideMetrics(driverUserId, from, now);
    List<MoneyAmountDto> earnings =
        driverLedgerRepository.fareEarnings(driverUserId, from, now).stream()
            .map(row -> new MoneyAmountDto(row.getCurrency(), row.getAmount()))
            .toList();
    return new MetricWindowDto(
        days,
        percentage(offers.getAccepted(), offers.getDecided()),
        percentage(rides.getCancelledByDriver(), rides.getCancellationBase()),
        percentage(rides.getOnTime(), rides.getArrived()),
        rides.getTrips(),
        earnings);
  }

  private static PercentageDto percentage(long numerator, long denominator) {
    return new PercentageDto(TrustRules.percent(numerator, denominator), numerator, denominator);
  }

  @Override
  @Transactional(readOnly = true)
  public List<MetricWarningDto> activeWarnings(UUID driverUserId) {
    return driverMetricWarningRepository
        .findByDriverUserIdAndClearedAtIsNullOrderByRaisedAtAsc(driverUserId)
        .stream()
        .map(DriverPerformanceServiceImpl::toDto)
        .toList();
  }

  @Override
  @Transactional(readOnly = true)
  public List<UUID> warningCandidates() {
    Set<UUID> drivers = new LinkedHashSet<>();
    drivers.addAll(
        rideRepository.findDriversActiveSince(
            clock.instant().minus(Duration.ofDays(MAX_WINDOW_DAYS))));
    drivers.addAll(driverMetricWarningRepository.findDriversWithActiveWarnings());
    return new ArrayList<>(drivers);
  }

  @Override
  public int evaluateWarnings(UUID driverUserId) {
    TrustRules.MetricRule rule =
        TrustRules.metricRule(
            latestRegion(driverUserId).map(Region::getMetricWarnings).orElse(null));
    Instant now = clock.instant();
    Instant from = now.minus(Duration.ofDays(rule.windowDays()));
    RideOfferRepository.OfferCounts offers =
        rideOfferRepository.offerCounts(driverUserId, from, now);
    RideRepository.DriverRideMetrics rides =
        rideRepository.driverRideMetrics(driverUserId, from, now);
    int raised = 0;
    raised +=
        apply(
            driverUserId,
            DriverMetric.ACCEPTANCE,
            TrustRules.acceptanceBreached(offers.getAccepted(), offers.getDecided(), rule),
            offers.getAccepted(),
            offers.getDecided(),
            rule.minAcceptancePercent(),
            rule.windowDays(),
            now);
    raised +=
        apply(
            driverUserId,
            DriverMetric.CANCELLATION,
            TrustRules.cancellationBreached(
                rides.getCancelledByDriver(), rides.getCancellationBase(), rule),
            rides.getCancelledByDriver(),
            rides.getCancellationBase(),
            rule.maxCancellationPercent(),
            rule.windowDays(),
            now);
    return raised;
  }

  /**
   * Raises a warning on a new breach (push + flag), keeps an active one while the breach holds,
   * clears it once the condition (enough sample AND beyond the threshold) no longer holds.
   */
  private int apply(
      UUID driverUserId,
      DriverMetric metric,
      boolean breached,
      long numerator,
      long denominator,
      BigDecimal threshold,
      int windowDays,
      Instant now) {
    Optional<DriverMetricWarning> active =
        driverMetricWarningRepository.findByDriverUserIdAndMetricAndClearedAtIsNull(
            driverUserId, metric);
    if (!breached) {
      active.ifPresent(
          warning -> {
            warning.setClearedAt(now);
            driverMetricWarningRepository.save(warning);
          });
      return 0;
    }
    if (active.isPresent()) {
      return 0;
    }
    BigDecimal value =
        TrustRules.exactPercent(numerator, denominator).setScale(2, RoundingMode.HALF_UP);
    driverMetricWarningRepository.saveAndFlush(
        DriverMetricWarning.builder()
            .driverUserId(driverUserId)
            .metric(metric)
            .valuePercent(value)
            .thresholdPercent(threshold)
            .windowDays((short) windowDays)
            .sampleSize((int) denominator)
            .raisedAt(now)
            .build());
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("metric", metric.getValue());
    params.put("valuePercent", value.toPlainString());
    params.put("thresholdPercent", threshold.toPlainString());
    params.put("windowDays", windowDays);
    notificationService.queue(driverUserId, NotificationEvent.DRIVER_METRIC_WARNING, params);
    Map<String, Object> details = new LinkedHashMap<>();
    details.put("metric", metric.getValue());
    details.put("valuePercent", value);
    details.put("thresholdPercent", threshold);
    details.put("windowDays", windowDays);
    details.put("sampleSize", denominator);
    accountFlagService.open(driverUserId, RideParty.DRIVER, FlagKind.METRIC_WARNING, details);
    return 1;
  }

  /** The region of the driver's latest ride (trust-v1.yaml "the driver's region"). */
  private Optional<Region> latestRegion(UUID driverUserId) {
    return rideRepository
        .findByDriverUserIdOrderByRequestedAtDesc(driverUserId, PageRequest.of(0, 1))
        .stream()
        .findFirst()
        .flatMap(ride -> regionRepository.findById(ride.getRegionId()));
  }

  private static MetricWarningDto toDto(DriverMetricWarning warning) {
    return new MetricWarningDto(
        warning.getMetric(),
        warning.getValuePercent(),
        warning.getThresholdPercent(),
        warning.getMetric() == DriverMetric.ACCEPTANCE ? "below" : "above",
        warning.getWindowDays(),
        warning.getSampleSize(),
        warning.getRaisedAt());
  }
}
