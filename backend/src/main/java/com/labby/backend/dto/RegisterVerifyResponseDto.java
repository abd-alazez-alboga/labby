package com.labby.backend.dto;

import com.labby.backend.enums.RegistrationMode;

/**
 * Result of OTP verification: continue a new signup with the registration token, or the deleted
 * account was reactivated (USR-07) and the user should log in.
 */
public record RegisterVerifyResponseDto(RegistrationMode mode, String registrationToken) {}
