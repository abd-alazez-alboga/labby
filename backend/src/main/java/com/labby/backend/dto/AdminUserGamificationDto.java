package com.labby.backend.dto;

/**
 * One user's badges and levels for the admin profile (growth-v1 AdminUserGamification; UC-A-13):
 * the rider view and the driver view exactly as {@code GET /gamification/me} serves them to the
 * user, each null when the user does not hold that role.
 */
public record AdminUserGamificationDto(GamificationViewDto rider, GamificationViewDto driver) {}
