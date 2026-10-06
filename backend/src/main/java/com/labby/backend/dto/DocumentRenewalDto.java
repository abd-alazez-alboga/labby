package com.labby.backend.dto;

/**
 * A renewal beside the document it replaces (UC-A-12).
 *
 * @param driver the driver
 * @param renewal the renewal
 * @param current the document it replaces
 * @param driverSuspended the driver role is suspended for document expiry
 */
public record DocumentRenewalDto(
    ApplicantDto driver, DocumentDto renewal, DocumentDto current, boolean driverSuspended) {}
