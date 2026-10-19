package com.labby.backend.service;

import com.labby.backend.dto.ChallengeDetailDto;
import com.labby.backend.dto.ChallengeDto;
import com.labby.backend.dto.ChallengePageDto;
import com.labby.backend.dto.PatchPromoRequestDto;
import com.labby.backend.dto.PromoDetailDto;
import com.labby.backend.dto.PromoDto;
import com.labby.backend.dto.PromoPageDto;
import com.labby.backend.dto.SaveChallengeRequestDto;
import com.labby.backend.dto.SavePromoRequestDto;
import java.util.UUID;

/** Admin promos and challenges (UC-A-26/28, growth-v1), permission-gated and audited. */
public interface AdminGrowthService {

  PromoDto createPromo(UUID actorUserId, SavePromoRequestDto request);

  PromoPageDto listPromos(UUID regionId, Boolean active, Boolean running, int page, int size);

  PromoDetailDto promoDetail(UUID promoId, int page, int size);

  PromoDto patchPromo(UUID actorUserId, UUID promoId, PatchPromoRequestDto request);

  ChallengeDto createChallenge(UUID actorUserId, SaveChallengeRequestDto request);

  ChallengePageDto listChallenges(UUID regionId, int page, int size);

  ChallengeDetailDto challengeDetail(UUID challengeId, int page, int size);

  ChallengeDto endChallenge(UUID actorUserId, UUID challengeId);
}
