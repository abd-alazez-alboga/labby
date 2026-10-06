package com.labby.backend.dto;

import java.util.List;

/**
 * A vehicle switch (UC-D-18): the new vehicle plus its registration and insurance.
 *
 * @param vehicle the new vehicle
 * @param documents exactly one {@code vehicle_registration} and one {@code insurance}
 */
public record VehicleSwitchRequestDto(VehicleInputDto vehicle, List<DocumentInputDto> documents) {}
