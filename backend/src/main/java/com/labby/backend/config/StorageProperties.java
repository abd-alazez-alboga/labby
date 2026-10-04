package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Private upload storage (NFR-S2).
 *
 * @param dir local directory for private uploads
 * @param photoMaxBytes maximum accepted profile-photo size
 */
@ConfigurationProperties(prefix = "labby.storage")
public record StorageProperties(String dir, long photoMaxBytes) {}
