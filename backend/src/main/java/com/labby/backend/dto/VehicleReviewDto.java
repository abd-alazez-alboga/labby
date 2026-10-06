package com.labby.backend.dto;

/**
 * A vehicle switch under review (UC-A-11): the new vehicle with its documents beside the current
 * active one.
 *
 * @param driver the driver
 * @param vehicle the switch vehicle with its registration + insurance
 * @param currentVehicle the driver's active vehicle, or null
 * @param duplicatePlate the plate is on another driver's active vehicle
 */
public record VehicleReviewDto(
    ApplicantDto driver,
    VehicleWithDocumentsDto vehicle,
    VehicleDto currentVehicle,
    boolean duplicatePlate) {}
