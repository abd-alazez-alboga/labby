package com.labby.backend.dto;

import com.labby.backend.enums.ComfortConversation;
import com.labby.backend.enums.ComfortMusic;
import com.labby.backend.enums.ComfortTemperature;
import com.labby.backend.enums.PickupDistanceMode;
import jakarta.validation.constraints.NotNull;

/** Comfort preferences + the matching toggle (UC-R-02/03). */
public record RiderPreferencesDto(
    @NotNull ComfortTemperature temperature,
    @NotNull ComfortConversation conversation,
    @NotNull ComfortMusic music,
    @NotNull PickupDistanceMode pickupDistanceMode) {}
