package com.labby.backend.dto;

import com.labby.backend.enums.ClientType;
import com.labby.backend.enums.DevicePlatform;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Registers this device's FCM token (realtime-v1.yaml {@code DeviceRegistration}, ES-03).
 *
 * @param token the FCM registration token
 * @param platform android, ios or web
 * @param app the client the token belongs to (decides which notifications it receives)
 */
public record DeviceRegistrationDto(
    @NotBlank @Size(max = 4096) String token,
    @NotNull DevicePlatform platform,
    @NotNull ClientType app) {}
