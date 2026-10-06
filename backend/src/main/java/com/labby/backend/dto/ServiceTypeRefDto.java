package com.labby.backend.dto;

import java.util.UUID;

/**
 * A service type a vehicle can be assigned, with its region (DRV-03).
 *
 * @param id the service type id
 * @param regionId the region id
 * @param regionName the region name
 * @param nameEn English name
 * @param nameAr Arabic name
 */
public record ServiceTypeRefDto(
    UUID id, UUID regionId, String regionName, String nameEn, String nameAr) {}
