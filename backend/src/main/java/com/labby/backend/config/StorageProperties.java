package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Private upload storage (NFR-S2).
 *
 * @param dir local directory for private uploads
 * @param photoMaxBytes maximum accepted profile-photo size
 * @param driverFileMaxBytes maximum accepted driver document / vehicle-photo size (M5)
 * @param urlTtlSeconds lifetime of an expiring file-access URL (M5)
 * @param driverFileDailyCap uploads one user may make to {@code /driver/files} per rolling 24 h
 * @param orphanFileRetentionDays age after which an upload no document or vehicle photo references
 *     is deleted by the nightly cleanup
 */
@ConfigurationProperties(prefix = "labby.storage")
public record StorageProperties(
    String dir,
    long photoMaxBytes,
    long driverFileMaxBytes,
    long urlTtlSeconds,
    int driverFileDailyCap,
    int orphanFileRetentionDays) {}
