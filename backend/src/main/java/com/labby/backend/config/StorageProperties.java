package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Private upload storage (NFR-S2).
 *
 * @param dir local directory for private uploads
 * @param photoMaxBytes maximum accepted profile-photo size
 * @param driverFileMaxBytes maximum accepted driver document / vehicle-photo size (M5)
 * @param urlTtlSeconds lifetime of an expiring file-access URL (M5)
 */
@ConfigurationProperties(prefix = "labby.storage")
public record StorageProperties(
    String dir, long photoMaxBytes, long driverFileMaxBytes, long urlTtlSeconds) {}
