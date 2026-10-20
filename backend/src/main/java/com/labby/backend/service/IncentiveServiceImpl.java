package com.labby.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.dto.IncentiveAwardDto;
import com.labby.backend.dto.IncentiveProgressDto;
import com.labby.backend.dto.IncentiveProgressDto.PeakDto;
import com.labby.backend.dto.IncentiveProgressDto.RatingDto;
import com.labby.backend.dto.IncentiveProgressDto.TierDto;
import com.labby.backend.dto.IncentiveProgressDto.WeeklyTripsDto;
import com.labby.backend.dto.IncentiveValuesDto;
import com.labby.backend.dto.PeakWindowDto;
import com.labby.backend.dto.WeeklyTripBonusDto;
import com.labby.backend.enums.DriverLedgerType;
import com.labby.backend.enums.IncentiveKind;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.DriverLedgerEntry;
import com.labby.backend.model.IncentiveAward;
import com.labby.backend.model.Region;
import com.labby.backend.repository.IncentiveAwardRepository;
import com.labby.backend.repository.IncentiveStatsRepository;
import com.labby.backend.repository.IncentiveStatsRepository.CompletedTrip;
import com.labby.backend.repository.IncentiveStatsRepository.RatingStats;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.service.DriverLedgerService.LedgerPosting;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Rules per incentives-v1 (owner rulings 2026-10-20) via {@link IncentivePolicy}. Each award pays
 * in its own transaction: ledger {@code bonus} entry + award row + notification commit together,
 * and the award's unique key makes a re-run (or a concurrent run) pay nothing twice.
 */
@Slf4j
@Service
public class IncentiveServiceImpl implements IncentiveService {

  private static final int RECENT_AWARDS = 8;

  /** The exactly-once key (V31): its violation is a concurrent run that paid first. */
  private static final String WEEK_KEY = "uq_incentive_awards_week";

  private final RegionRepository regionRepository;
  private final IncentiveStatsRepository statsRepository;
  private final IncentiveAwardRepository awardRepository;
  private final DriverLedgerService driverLedgerService;
  private final NotificationService notificationService;
  private final RideAccess rideAccess;
  private final ObjectMapper objectMapper;
  private final Clock clock;
  private final TransactionTemplate awardTransaction;

  public IncentiveServiceImpl(
      RegionRepository regionRepository,
      IncentiveStatsRepository statsRepository,
      IncentiveAwardRepository awardRepository,
      DriverLedgerService driverLedgerService,
      NotificationService notificationService,
      RideAccess rideAccess,
      ObjectMapper objectMapper,
      Clock clock,
      PlatformTransactionManager transactionManager) {
    this.regionRepository = regionRepository;
    this.statsRepository = statsRepository;
    this.awardRepository = awardRepository;
    this.driverLedgerService = driverLedgerService;
    this.notificationService = notificationService;
    this.rideAccess = rideAccess;
    this.objectMapper = objectMapper;
    this.clock = clock;
    this.awardTransaction = new TransactionTemplate(transactionManager);
    this.awardTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  /** A week of one region, in its zone: Monday's date and the instant bounds. */
  private record Week(LocalDate start, Instant from, Instant to) {

    static Week containing(Instant at, ZoneId zone) {
      LocalDate monday = CommissionPolicy.weekStart(at, zone);
      return new Week(
          monday,
          monday.atStartOfDay(zone).toInstant(),
          monday.plusWeeks(1).atStartOfDay(zone).toInstant());
    }

    Week previous(ZoneId zone) {
      return containing(from.minusSeconds(1), zone);
    }
  }

  /** One award to pay. */
  private record Award(
      UUID driverUserId,
      IncentiveKind kind,
      int trips,
      Integer threshold,
      BigDecimal avgRating,
      BigDecimal amount) {}

  /**
   * Each region pays its own last finished week; a region or an award that fails is logged and
   * skipped so the rest of the run still pays (the next run retries it — awards are exactly-once).
   */
  @Override
  public int evaluatePreviousWeek(Instant now) {
    int paid = 0;
    for (Region region : regionRepository.findAll()) {
      try {
        paid += evaluateRegion(region, now);
      } catch (RuntimeException failed) {
        log.error("Incentive evaluation of region {} failed", region.getId(), failed);
      }
    }
    return paid;
  }

  private int evaluateRegion(Region region, Instant now) {
    IncentiveValuesDto config = config(region);
    if (config == null) {
      return 0;
    }
    ZoneId zone = ZoneId.of(region.getTimeZone());
    Week week = Week.containing(now, zone).previous(zone);
    int paid = 0;
    for (Award award : awards(region, config, zone, week)) {
      if (IncentivePolicy.money(award.amount()).signum() <= 0) {
        // A positive amount below half a cent rounds to 0.00, which the award CHECK refuses.
        log.debug(
            "Incentive {} for {} rounds to 0.00; not paid", award.kind(), award.driverUserId());
        continue;
      }
      try {
        if (pay(region, week, award)) {
          paid++;
        }
      } catch (RuntimeException failed) {
        log.error(
            "Incentive {} for {} in region {} failed",
            award.kind(),
            award.driverUserId(),
            region.getId(),
            failed);
      }
    }
    return paid;
  }

  private List<Award> awards(Region region, IncentiveValuesDto config, ZoneId zone, Week week) {
    List<CompletedTrip> trips =
        statsRepository.completedTrips(region.getId(), week.from(), week.to(), null);
    Map<UUID, Long> tripsByDriver =
        trips.stream()
            .collect(
                Collectors.groupingBy(
                    CompletedTrip::driverUserId, LinkedHashMap::new, Collectors.counting()));
    List<PeakWindowDto> windows = IncentivePolicy.windows(config);
    Map<UUID, Long> peakByDriver =
        trips.stream()
            .filter(t -> IncentivePolicy.coveringWindow(windows, t.pricedAt(), zone).isPresent())
            .collect(Collectors.groupingBy(CompletedTrip::driverUserId, Collectors.counting()));
    Map<UUID, RatingStats> ratings =
        statsRepository.ratingStats(region.getId(), week.from(), week.to(), null).stream()
            .collect(Collectors.toMap(RatingStats::driverUserId, Function.identity()));
    List<WeeklyTripBonusDto> tiers = IncentivePolicy.tiers(config);
    BigDecimal peakBonus = config.peakHourBonusPerTrip();
    List<Award> awards = new ArrayList<>();
    tripsByDriver.forEach(
        (driver, count) -> {
          int weekTrips = count.intValue();
          IncentivePolicy.reachedTier(tiers, weekTrips)
              .filter(tier -> tier.amount().signum() > 0)
              .ifPresent(
                  tier ->
                      awards.add(
                          new Award(
                              driver,
                              IncentiveKind.WEEKLY_TRIPS,
                              weekTrips,
                              tier.trips(),
                              null,
                              tier.amount())));
          int peakTrips = peakByDriver.getOrDefault(driver, 0L).intValue();
          if (peakTrips > 0 && peakBonus.signum() > 0) {
            awards.add(
                new Award(
                    driver,
                    IncentiveKind.PEAK_HOURS,
                    peakTrips,
                    null,
                    null,
                    peakBonus.multiply(BigDecimal.valueOf(peakTrips))));
          }
          RatingStats stats = ratings.get(driver);
          BigDecimal average = stats == null ? null : stats.average();
          if (IncentivePolicy.ratingQualifies(config, average, weekTrips)
              && config.ratingReward().amount().signum() > 0) {
            awards.add(
                new Award(
                    driver,
                    IncentiveKind.RATING,
                    weekTrips,
                    null,
                    IncentivePolicy.displayAverage(average),
                    config.ratingReward().amount()));
          }
        });
    return awards;
  }

  /**
   * Pays one award in its own transaction; false when it was already paid. Any other failure
   * propagates (rolled back) to the caller, which logs it and moves on.
   */
  private boolean pay(Region region, Week week, Award award) {
    try {
      return Boolean.TRUE.equals(
          awardTransaction.execute(
              status -> {
                if (awardRepository.existsByDriverUserIdAndRegionIdAndWeekStartAndKind(
                    award.driverUserId(), region.getId(), week.start(), award.kind())) {
                  return false;
                }
                BigDecimal amount = IncentivePolicy.money(award.amount());
                DriverLedgerEntry entry =
                    driverLedgerService.post(
                        new LedgerPosting(
                            award.driverUserId(),
                            region.getCurrency(),
                            amount,
                            DriverLedgerType.BONUS,
                            null,
                            null,
                            null,
                            null,
                            null,
                            null,
                            null));
                awardRepository.saveAndFlush(
                    IncentiveAward.builder()
                        .driverUserId(award.driverUserId())
                        .regionId(region.getId())
                        .weekStart(week.start())
                        .kind(award.kind())
                        .trips(award.trips())
                        .threshold(award.threshold())
                        .avgRating(award.avgRating())
                        .amount(amount)
                        .currency(region.getCurrency())
                        .driverLedgerId(entry.getId())
                        .createdAt(clock.instant())
                        .build());
                Map<String, Object> params = new HashMap<>();
                params.put("kind", award.kind().getValue());
                params.put("amount", amount.toPlainString());
                params.put("currency", region.getCurrency());
                params.put("weekStart", week.start().toString());
                params.put("trips", award.trips());
                if (award.avgRating() != null) {
                  params.put("avgRating", award.avgRating().toPlainString());
                }
                notificationService.queue(
                    award.driverUserId(), NotificationEvent.INCENTIVE_AWARDED, params);
                return true;
              }));
    } catch (DataIntegrityViolationException raced) {
      if (!String.valueOf(raced.getMostSpecificCause().getMessage()).contains(WEEK_KEY)) {
        throw raced;
      }
      // A concurrent run paid it first; the unique key rolled this one back.
      log.info("Incentive {} for {} already paid", award.kind(), award.driverUserId());
      return false;
    }
  }

  @Override
  @Transactional(readOnly = true)
  public IncentiveProgressDto progress(UUID driverUserId, UUID regionId) {
    rideAccess.requireDriver(driverUserId);
    Region region =
        regionRepository
            .findById(regionId)
            .orElseThrow(() -> new ResourceNotFoundException("Region", regionId));
    ZoneId zone = ZoneId.of(region.getTimeZone());
    Instant now = clock.instant();
    Week week = Week.containing(now, zone);
    List<IncentiveAwardDto> recent =
        awardRepository
            .findTop8ByDriverUserIdAndRegionIdOrderByWeekStartDescCreatedAtDesc(
                driverUserId, regionId)
            .stream()
            .limit(RECENT_AWARDS)
            .map(
                award ->
                    new IncentiveAwardDto(
                        award.getWeekStart(),
                        award.getKind(),
                        award.getAmount(),
                        award.getCurrency(),
                        award.getTrips(),
                        award.getThreshold(),
                        award.getAvgRating(),
                        award.getCreatedAt()))
            .toList();
    IncentiveValuesDto config = config(region);
    if (config == null) {
      return new IncentiveProgressDto(
          region.getId(),
          region.getName(),
          false,
          region.getCurrency(),
          week.start(),
          week.start().plusDays(6),
          region.getTimeZone(),
          null,
          null,
          null,
          recent);
    }
    List<CompletedTrip> trips =
        statsRepository.completedTrips(regionId, week.from(), week.to(), driverUserId);
    int weekTrips = trips.size();
    List<WeeklyTripBonusDto> tiers = IncentivePolicy.tiers(config);
    List<PeakWindowDto> windows = IncentivePolicy.windows(config);
    int peakTrips =
        (int)
            trips.stream()
                .filter(
                    t -> IncentivePolicy.coveringWindow(windows, t.pricedAt(), zone).isPresent())
                .count();
    RatingStats stats =
        statsRepository.ratingStats(regionId, week.from(), week.to(), driverUserId).stream()
            .findFirst()
            .orElse(null);
    BigDecimal average = stats == null ? null : stats.average();
    return new IncentiveProgressDto(
        region.getId(),
        region.getName(),
        true,
        region.getCurrency(),
        week.start(),
        week.start().plusDays(6),
        region.getTimeZone(),
        new WeeklyTripsDto(
            weekTrips,
            tiers.stream().map(IncentiveServiceImpl::tier).toList(),
            IncentivePolicy.reachedTier(tiers, weekTrips)
                .map(IncentiveServiceImpl::tier)
                .orElse(null),
            IncentivePolicy.nextTier(tiers, weekTrips)
                .map(IncentiveServiceImpl::tier)
                .orElse(null)),
        new PeakDto(
            IncentivePolicy.money(config.peakHourBonusPerTrip()),
            windows,
            IncentivePolicy.activeUntil(windows, now, zone).isPresent(),
            IncentivePolicy.activeUntil(windows, now, zone).orElse(null),
            peakTrips,
            IncentivePolicy.money(
                config.peakHourBonusPerTrip().multiply(BigDecimal.valueOf(peakTrips)))),
        new RatingDto(
            IncentivePolicy.money(config.ratingReward().amount()),
            config.ratingReward().minAvgRating(),
            config.ratingReward().minWeeklyTrips(),
            IncentivePolicy.displayAverage(average),
            stats == null ? 0 : stats.count(),
            weekTrips,
            IncentivePolicy.ratingQualifies(config, average, weekTrips)),
        recent);
  }

  private static TierDto tier(WeeklyTripBonusDto tier) {
    return new TierDto(tier.trips(), IncentivePolicy.money(tier.amount()));
  }

  /** The region's incentive values, or null when it has none. */
  private IncentiveValuesDto config(Region region) {
    Map<String, Object> values = region.getIncentiveValues();
    return values == null || values.isEmpty()
        ? null
        : objectMapper.convertValue(values, IncentiveValuesDto.class);
  }
}
