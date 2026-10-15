package com.labby.backend.service;

import com.labby.backend.dto.AccountFlagDto;
import com.labby.backend.dto.AccountFlagPageDto;
import com.labby.backend.dto.FlagResolveRequestDto;
import com.labby.backend.enums.FlagKind;
import com.labby.backend.enums.RideParty;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The flagged-accounts queue (ADM-04, UC-A-16): low rating (RATE-03), metric warning (DRV-07) and
 * report threshold (REP-03) flags, one OPEN flag per user x role x kind.
 */
public interface AccountFlagService {

  /**
   * Opens a flag unless one of the same user x role x kind is already open — inside the caller's
   * transaction, never failing it.
   *
   * @param userId the flagged user
   * @param role the flagged role
   * @param kind why
   * @param details the triggering evaluation (shape per kind, trust-v1.yaml)
   * @return true when a flag was opened now
   */
  boolean open(UUID userId, RideParty role, FlagKind kind, Map<String, Object> details);

  /**
   * One queue page, oldest first.
   *
   * @param status {@code open} (default), {@code actioned} or {@code dismissed}
   * @param kind optional kind filter
   * @param userId optional user filter
   * @param page zero-based page
   * @param size page size
   * @return the page
   * @throws com.labby.backend.exception.InvalidRequestException for an unknown status or kind
   */
  AccountFlagPageDto queue(String status, String kind, UUID userId, int page, int size);

  /**
   * Closes an open flag with a note (audited). Suspending is a separate call.
   *
   * @param actorUserId the admin
   * @param flagId the flag
   * @param request the resolution and note
   * @return the closed flag
   * @throws com.labby.backend.exception.ResourceNotFoundException for an unknown flag
   * @throws com.labby.backend.exception.ConflictException {@code already_resolved}
   */
  AccountFlagDto resolve(UUID actorUserId, UUID flagId, FlagResolveRequestDto request);

  /**
   * A user's open flags, oldest first (the admin trust profile).
   *
   * @param userId the user
   * @return the flags
   */
  List<AccountFlagDto> openFlags(UUID userId);
}
