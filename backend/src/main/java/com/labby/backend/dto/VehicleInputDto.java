package com.labby.backend.dto;

import java.util.List;
import java.util.UUID;

/**
 * Vehicle details of a submission or switch (DRV-03). Validated by the service (keys {@code
 * vehicle.<field>}); the plate is stored upper-cased with whitespace removed.
 *
 * @param make the make
 * @param model the model
 * @param year the model year (1980..next calendar year)
 * @param color the colour
 * @param plate the plate, free text (Arabic allowed)
 * @param seats passenger seats (1..8)
 * @param photoFileIds 1..4 own uploads of kind {@code vehicle_photo}, first shown to riders
 */
public record VehicleInputDto(
    String make,
    String model,
    Integer year,
    String color,
    String plate,
    Integer seats,
    List<UUID> photoFileIds) {}
