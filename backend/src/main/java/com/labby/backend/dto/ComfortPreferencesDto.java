package com.labby.backend.dto;

import com.labby.backend.enums.ComfortConversation;
import com.labby.backend.enums.ComfortMusic;
import com.labby.backend.enums.ComfortTemperature;

/** Rider comfort preferences as the driver sees them (UC-R-02). */
public record ComfortPreferencesDto(
    ComfortTemperature temperature, ComfortConversation conversation, ComfortMusic music) {}
