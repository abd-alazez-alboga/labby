package com.labby.backend.service;

import com.labby.backend.dto.ChallengeViewDto;
import com.labby.backend.dto.GamificationViewDto;
import com.labby.backend.enums.RideParty;
import java.util.List;
import java.util.UUID;

/** Badges, levels and the user-side challenge list (GAME-01..03; UC-S-23/24). */
public interface GamificationService {

  /**
   * The caller's badges and level as one role.
   *
   * @param userId the caller
   * @param as the role view (rider or driver)
   * @return the view
   */
  GamificationViewDto me(UUID userId, RideParty as);

  /**
   * The region + role's challenges with the caller's progress: running first, then upcoming, then
   * recently ended.
   *
   * @param userId the caller
   * @param regionId the region
   * @param as the role
   * @return the list
   */
  List<ChallengeViewDto> challenges(UUID userId, UUID regionId, RideParty as);
}
