package com.labby.backend.service;

import com.labby.backend.dto.ShareLinkDto;
import com.labby.backend.dto.SharePageDto;
import java.util.UUID;

/**
 * Trip sharing (SHARE-01/02, UC-S-15): a party of an active accepted ride mints one unguessable
 * public link; the no-login page polls the token endpoint until the ride turns terminal (410).
 */
public interface ShareService {

  /**
   * Creates the caller's share link for the ride — the ONLY time the raw token/url exists (only its
   * SHA-256 is stored).
   *
   * @param userId the calling party
   * @param rideId the ride
   * @return the public url
   * @throws com.labby.backend.exception.ResourceNotFoundException the ride is unknown or the caller
   *     is not a party (404 — the ride's existence is not revealed)
   * @throws com.labby.backend.exception.ConflictException {@code ride_not_active} outside an active
   *     accepted ride, {@code already_shared} when this user already holds this ride's link (also
   *     for a concurrent double tap)
   */
  ShareLinkDto create(UUID userId, UUID rideId);

  /**
   * The public share-page data for a raw token — NO authentication (SHARE-02).
   *
   * @param token the raw url token
   * @return exactly the SHARE-02 list
   * @throws com.labby.backend.exception.ResourceNotFoundException unknown token
   * @throws com.labby.backend.exception.GoneException the ride ended or was cancelled — the link is
   *     permanently dead
   */
  SharePageDto page(String token);
}
