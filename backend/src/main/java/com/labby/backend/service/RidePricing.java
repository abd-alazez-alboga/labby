package com.labby.backend.service;

import com.labby.backend.dto.EstimateDto;
import com.labby.backend.dto.FareComponentsDto;
import com.labby.backend.dto.LatLngDto;
import com.labby.backend.dto.PlaceDto;
import com.labby.backend.dto.RouteDto;
import com.labby.backend.exception.BusinessRuleViolationException;
import com.labby.backend.model.Region;
import com.labby.backend.model.ServiceType;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.SurchargeWindowRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * The booking-side pricing glue (RIDE-01, PRC-01): resolves the pickup's region, keeps the whole
 * route inside it, routes pickup → stops → destination through the {@link RoutingProvider} (an
 * unreachable router yields an {@code approximate} straight-line route, NFR-A3) and prices it with
 * the {@link FareCalculator}.
 */
@Component
@RequiredArgsConstructor
public class RidePricing {

  /** RIDE-01: at most three intermediate stops. */
  public static final int MAX_STOPS = 3;

  /** The surge multiplier until M9 computes zone values (PRC-02). */
  public static final BigDecimal NO_SURGE = BigDecimal.ONE;

  private final RegionRepository regionRepository;
  private final SurchargeWindowRepository surchargeWindowRepository;
  private final RoutingProvider routingProvider;
  private final FareCalculator fareCalculator;
  private final Clock clock;

  /**
   * The active region whose boundary covers the pickup (shared border: first by name, SD-01).
   *
   * @param pickup the pickup
   * @return the region
   * @throws BusinessRuleViolationException {@code outside_region} (UC-R-04 E1)
   */
  public Region regionOf(PlaceDto pickup) {
    return regionRepository.findActiveRegionsCovering(pickup.lat(), pickup.lng()).stream()
        .findFirst()
        .orElseThrow(
            () ->
                new BusinessRuleViolationException("Pickup is outside our operating area")
                    .withCode("outside_region"));
  }

  /**
   * Checks the stop count and that destination + stops lie inside the region.
   *
   * @param region the pickup's region
   * @param destination the destination
   * @param stops the stops (may be null)
   */
  public void checkRoute(Region region, PlaceDto destination, List<PlaceDto> stops) {
    List<PlaceDto> safeStops = stops == null ? List.of() : stops;
    if (safeStops.size() > MAX_STOPS) {
      throw new BusinessRuleViolationException("A ride can have at most 3 stops")
          .withCode("too_many_stops");
    }
    List<PlaceDto> points = new ArrayList<>(safeStops);
    points.add(destination);
    for (PlaceDto point : points) {
      if (!regionRepository.coversPoint(region.getId(), point.lat(), point.lng())) {
        throw new BusinessRuleViolationException(
                "Every stop and the destination must be inside the pickup's operating area")
            .withCode("outside_region");
      }
    }
  }

  /**
   * Routes pickup → stops → destination.
   *
   * @param pickup the start
   * @param stops intermediate stops (may be null)
   * @param destination the end
   * @return the route (approximate when the router was unreachable)
   */
  public RouteDto route(PlaceDto pickup, List<PlaceDto> stops, PlaceDto destination) {
    List<LatLngDto> points = new ArrayList<>();
    points.add(new LatLngDto(pickup.lat(), pickup.lng()));
    if (stops != null) {
      stops.forEach(stop -> points.add(new LatLngDto(stop.lat(), stop.lng())));
    }
    points.add(new LatLngDto(destination.lat(), destination.lng()));
    return routingProvider.route(points);
  }

  /**
   * The surcharge percent in force now in the region (highest covering window).
   *
   * @param region the region
   * @return the percent (0 when none)
   */
  public BigDecimal surchargeNow(Region region) {
    return surchargePercentAt(region, clock.instant());
  }

  /**
   * The surcharge percent in force at a moment in the region.
   *
   * @param region the region
   * @param at the moment
   * @return the percent (0 when none)
   */
  public BigDecimal surchargePercentAt(Region region, Instant at) {
    return fareCalculator.surchargePercent(
        surchargeWindowRepository.findByRegionIdOrderByStartsAtAsc(region.getId()),
        at,
        ZoneId.of(region.getTimeZone()));
  }

  /**
   * Prices a route for a service type.
   *
   * @param serviceType the service type
   * @param currency the region currency
   * @param route the route
   * @param surchargePercent the (locked) surcharge
   * @param surgeMultiplier the (locked) surge
   * @return the estimate
   */
  public EstimateDto estimate(
      ServiceType serviceType,
      String currency,
      RouteDto route,
      BigDecimal surchargePercent,
      BigDecimal surgeMultiplier) {
    FareComponentsDto components =
        fareCalculator.price(
            serviceType,
            currency,
            route.distanceMeters(),
            route.durationSeconds(),
            surchargePercent,
            surgeMultiplier);
    return new EstimateDto(
        route.distanceMeters(), route.durationSeconds(), route.approximate(), components);
  }
}
