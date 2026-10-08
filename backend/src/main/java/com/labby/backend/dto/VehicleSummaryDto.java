package com.labby.backend.dto;

/** The vehicle a rider looks for at pickup. */
public record VehicleSummaryDto(
    String make, String model, String color, String plate, String photoUrl) {}
