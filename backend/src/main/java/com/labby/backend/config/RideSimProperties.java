package com.labby.backend.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The dev driver-simulation harness (M7-T5): seeded demo drivers that accept offers and drive their
 * rides along real routes so the ride loop runs without physical devices. Dev profile only; off by
 * default.
 *
 * @param enabled whether the simulator runs at all (dev profile only)
 * @param tickMs how often the simulator steps every sim driver
 * @param speedKmh how fast a sim driver moves along its route
 * @param acceptDelayTicks ticks between seeing an open offer and accepting it
 * @param dwellTicks ticks a sim driver lingers before arrive→start and complete→cash-confirm
 * @param phones the seeded driver accounts the simulator drives (never any other account)
 * @param centerLat where idle sim drivers wait (inside the demo region)
 * @param centerLng where idle sim drivers wait (inside the demo region)
 */
@ConfigurationProperties(prefix = "labby.ridesim")
public record RideSimProperties(
    boolean enabled,
    long tickMs,
    double speedKmh,
    int acceptDelayTicks,
    int dwellTicks,
    List<String> phones,
    double centerLat,
    double centerLng) {}
