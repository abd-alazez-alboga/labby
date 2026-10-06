package com.labby.backend.dto;

import java.util.UUID;

/**
 * The account behind an application, switch or document, as shown to reviewers.
 *
 * @param userId the account id
 * @param name the account name
 * @param phone the account phone
 */
public record ApplicantDto(UUID userId, String name, String phone) {}
