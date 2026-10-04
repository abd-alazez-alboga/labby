package com.labby.backend.dto;

/**
 * Public metadata about the running API, served by {@code GET /api/v1/meta}.
 *
 * @param name the application name from the Maven build info
 * @param version the application version from the Maven build info
 */
public record MetaResponseDto(String name, String version) {}
