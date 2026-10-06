package com.labby.backend.dto;

import java.util.Map;

/**
 * A notification deep link (realtime-v1.yaml {@code DeepLink}, UC-S-11): a screen id from the fixed
 * catalog plus its params.
 *
 * @param screen the screen id (e.g. {@code driver_documents})
 * @param params the screen params (empty when none)
 */
public record DeepLinkDto(String screen, Map<String, String> params) {}
