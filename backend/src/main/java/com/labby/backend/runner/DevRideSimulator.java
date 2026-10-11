package com.labby.backend.runner;

import com.labby.backend.config.RideSimProperties;
import com.labby.backend.dto.LatLngDto;
import com.labby.backend.dto.LocationSampleDto;
import com.labby.backend.dto.PlaceDto;
import com.labby.backend.dto.RideDto;
import com.labby.backend.dto.RideOfferDto;
import com.labby.backend.service.DriverAvailabilityService;
import com.labby.backend.service.DriverLocationService;
import com.labby.backend.service.DriverRideService;
import com.labby.backend.service.RoutingProvider;
import java.time.Clock;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Dev driver-simulation harness (M7-T5): steps the seeded demo drivers listed in {@code
 * labby.ridesim.phones} through the REAL ride loop — online + streaming every tick, offers
 * accepted, routes driven point by point (RoutingProvider), geofenced arrive, start, complete, cash
 * confirmed — all through the same services the REST controllers call, never by touching state
 * directly. This is the dev tool that lets a rider on the emulator take a full ride with no
 * physical driver device (the product mocks nothing). Dev profile only and off unless {@code
 * RIDE_SIM_ENABLED=true}; it never drives an account outside its configured list.
 */
@Slf4j
@Component
@Profile("dev")
@ConditionalOnProperty(prefix = "labby.ridesim", name = "enabled", havingValue = "true")
@RequiredArgsConstructor
public class DevRideSimulator {

  /** One simulated driver's in-memory state between ticks. */
  private static final class SimDriver {
    private final UUID userId;
    private final String phone;
    private double lat;
    private double lng;
    private final Deque<double[]> path = new ArrayDeque<>(); // [lat, lng] waypoints ahead
    private UUID pathRideId; // the ride the current path was routed for
    private boolean pathToPickup;
    private int waitTicks; // countdown before the next accept/start/cash action

    private SimDriver(UUID userId, String phone, double lat, double lng) {
      this.userId = userId;
      this.phone = phone;
      this.lat = lat;
      this.lng = lng;
    }
  }

  private final RideSimProperties properties;
  private final JdbcTemplate jdbcTemplate;
  private final DriverAvailabilityService availabilityService;
  private final DriverLocationService locationService;
  private final DriverRideService driverRideService;
  private final RoutingProvider routingProvider;
  private final Clock clock;

  private final Map<String, SimDriver> drivers = new HashMap<>();

  /** One simulator pass: every sim driver streams, answers offers and advances its ride. */
  @Scheduled(fixedDelayString = "${labby.ridesim.tick-ms}")
  public void tick() {
    int index = 0;
    for (String phone : properties.phones()) {
      int slot = index++;
      try {
        SimDriver driver = resolve(phone, slot);
        if (driver != null) {
          step(driver);
        }
      } catch (RuntimeException ex) {
        // Transient races with the dispatcher/rider are expected; try again next tick.
        log.debug("ridesim {}: {}", phone, ex.getMessage());
      }
    }
  }

  /** Looks the seeded account up once; idle drivers wait near the configured center. */
  private SimDriver resolve(String phone, int slot) {
    SimDriver known = drivers.get(phone);
    if (known != null) {
      return known;
    }
    List<UUID> ids =
        jdbcTemplate.queryForList(
            "SELECT u.user_id FROM users u JOIN driver_profiles p ON p.user_id = u.user_id"
                + " WHERE u.phone = ? AND p.application_status = 'approved'",
            UUID.class,
            phone);
    if (ids.isEmpty()) {
      return null; // not seeded (yet) — checked again next tick
    }
    SimDriver driver =
        new SimDriver(
            ids.get(0),
            phone,
            properties.centerLat() + slot * 0.004,
            properties.centerLng() + slot * 0.004);
    drivers.put(phone, driver);
    log.info("ridesim: driving {} from {}, {}", phone, driver.lat, driver.lng);
    return driver;
  }

  private void step(SimDriver driver) {
    if (!availabilityService.get(driver.userId).online()) {
      availabilityService.set(driver.userId, true);
    }
    Optional<RideDto> active = driverRideService.active(driver.userId);
    if (active.isEmpty()) {
      driver.pathRideId = null;
      stream(driver);
      Optional<RideOfferDto> offer = driverRideService.openOffer(driver.userId);
      if (offer.isEmpty()) {
        driver.waitTicks = properties.acceptDelayTicks();
      } else if (driver.waitTicks > 0) {
        driver.waitTicks--;
      } else {
        driverRideService.accept(driver.userId, offer.get().id());
        driver.waitTicks = properties.dwellTicks();
        log.info("ridesim {}: accepted offer for ride {}", driver.phone, offer.get().rideId());
      }
      return;
    }

    // Move first, stream the new position (arrive is geofenced on the latest STORED fix), then act.
    RideDto ride = active.get();
    switch (ride.state()) {
      case ACCEPTED -> {
        drive(driver, ride, true, List.of(ride.pickup()));
        stream(driver);
        if (driver.path.isEmpty()) {
          driverRideService.arrive(driver.userId, ride.id());
          driver.waitTicks = properties.dwellTicks();
          log.info("ridesim {}: arrived at pickup of ride {}", driver.phone, ride.id());
        }
      }
      case DRIVER_ARRIVED -> {
        stream(driver);
        if (driver.waitTicks-- <= 0) {
          driverRideService.start(driver.userId, ride.id());
          log.info("ridesim {}: started ride {}", driver.phone, ride.id());
        }
      }
      case IN_PROGRESS -> {
        List<PlaceDto> ahead = new ArrayList<>(ride.stops());
        ahead.add(ride.destination());
        drive(driver, ride, false, ahead);
        stream(driver);
        if (driver.path.isEmpty()) {
          driverRideService.complete(driver.userId, ride.id());
          driver.waitTicks = properties.dwellTicks();
          log.info("ridesim {}: completed ride {}", driver.phone, ride.id());
        }
      }
      case COMPLETED -> {
        stream(driver);
        if (driver.waitTicks-- <= 0) {
          driverRideService.confirmCash(driver.userId, ride.id());
          log.info("ridesim {}: cash confirmed for ride {}", driver.phone, ride.id());
        }
      }
      default -> {
        driver.pathRideId = null; // terminal states need nothing from the driver
        stream(driver);
      }
    }
  }

  /** Routes once per leg, then moves along the geometry at the configured speed. */
  private void drive(SimDriver driver, RideDto ride, boolean toPickup, List<PlaceDto> ahead) {
    if (!ride.id().equals(driver.pathRideId) || driver.pathToPickup != toPickup) {
      driver.path.clear();
      List<LatLngDto> points = new ArrayList<>();
      points.add(new LatLngDto(driver.lat, driver.lng));
      ahead.forEach(place -> points.add(new LatLngDto(place.lat(), place.lng())));
      // Route geometry is GeoJSON [lng, lat]; the path keeps [lat, lng].
      routingProvider
          .route(points)
          .geometry()
          .forEach(point -> driver.path.add(new double[] {point[1], point[0]}));
      driver.pathRideId = ride.id();
      driver.pathToPickup = toPickup;
    }
    double budget = properties.speedKmh() / 3.6 * properties.tickMs() / 1000.0;
    while (budget > 0 && !driver.path.isEmpty()) {
      double[] next = driver.path.peekFirst();
      double leg = distanceMeters(driver.lat, driver.lng, next[0], next[1]);
      if (leg <= budget) {
        driver.lat = next[0];
        driver.lng = next[1];
        driver.path.pollFirst();
        budget -= leg;
      } else {
        double ratio = budget / leg;
        driver.lat += (next[0] - driver.lat) * ratio;
        driver.lng += (next[1] - driver.lng) * ratio;
        budget = 0;
      }
    }
  }

  /** One location sample at the driver's current position — the stream dispatch gates require. */
  private void stream(SimDriver driver) {
    locationService.ingest(
        driver.userId,
        new LocationSampleDto(
            driver.lat, driver.lng, null, properties.speedKmh() / 3.6, 5.0, clock.instant()));
  }

  private static double distanceMeters(double lat1, double lng1, double lat2, double lng2) {
    double earthRadius = 6371000;
    double dLat = Math.toRadians(lat2 - lat1);
    double dLng = Math.toRadians(lng2 - lng1);
    double a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(lat1))
                * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2)
                * Math.sin(dLng / 2);
    return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
