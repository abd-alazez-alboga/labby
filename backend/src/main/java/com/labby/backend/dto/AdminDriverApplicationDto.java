package com.labby.backend.dto;

import com.fasterxml.jackson.annotation.JsonUnwrapped;

/**
 * The reviewer's view of a driver application (UC-A-10): the applicant view flattened, plus the
 * applicant and the duplicate-plate flag.
 *
 * @param application the application (serialized flat)
 * @param applicant the applying account
 * @param duplicatePlate the plate is on ANOTHER driver's active vehicle; blocks approval
 */
public record AdminDriverApplicationDto(
    @JsonUnwrapped DriverApplicationDto application,
    ApplicantDto applicant,
    boolean duplicatePlate) {}
