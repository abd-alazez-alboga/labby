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
import com.labby.backend.enums.PromoType;
import com.labby.backend.exception.BusinessRuleViolationException;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Challenge;
import com.labby.backend.model.Promo;
import com.labby.backend.model.PromoRedemption;
import com.labby.backend.model.User;
import com.labby.backend.repository.ChallengeProgressRepository;
import com.labby.backend.repository.ChallengeRepository;
import com.labby.backend.repository.PromoRedemptionRepository;
import com.labby.backend.repository.PromoRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.UserRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** UC-A-26/28. Every mutation is audited with before/after snapshots. */
@Service
@RequiredArgsConstructor
public class AdminGrowthServiceImpl implements AdminGrowthService {

  private final PromoRepository promoRepository;
  private final PromoRedemptionRepository promoRedemptionRepository;
  private final ChallengeRepository challengeRepository;
  private final ChallengeProgressRepository challengeProgressRepository;
  private final RegionRepository regionRepository;
  private final UserRepository userRepository;
  private final AuditService auditService;
  private final Clock clock;

  @Override
  @Transactional
  public PromoDto createPromo(UUID actorUserId, SavePromoRequestDto request) {
    String code = request.code().toUpperCase(Locale.ROOT);
    if (promoRepository.existsByCode(code)) {
      throw (ConflictException)
          new ConflictException("This code is already taken").withCode("promo_code_taken");
    }
    requireValidWindow(request.startsAt(), request.endsAt());
    if (request.type() == PromoType.PERCENT && request.value().compareTo(new BigDecimal(100)) > 0) {
      // M13 review W7: validated here so the V24 CHECK never surfaces as a 500.
      throw (BusinessRuleViolationException)
          new BusinessRuleViolationException("A percent discount cannot exceed 100")
              .withCode("value_invalid");
    }
    if (request.type() == PromoType.FIXED && request.regionId() == null) {
      throw (BusinessRuleViolationException)
          new BusinessRuleViolationException(
                  "A fixed-amount promo must be bound to a region (its currency)")
              .withCode("fixed_needs_region");
    }
    if (request.regionId() != null && !regionRepository.existsById(request.regionId())) {
      throw new ResourceNotFoundException("Region", request.regionId());
    }
    Promo promo =
        promoRepository.saveAndFlush(
            Promo.builder()
                .code(code)
                .regionId(request.regionId())
                .serviceTypeId(request.serviceTypeId())
                .type(request.type())
                .value(request.value())
                .maxDiscount(request.maxDiscount())
                .startsAt(request.startsAt())
                .endsAt(request.endsAt())
                .perUserLimit(request.perUserLimit() == null ? 1 : request.perUserLimit())
                .totalCap(request.totalCap())
                .firstRideOnly(Boolean.TRUE.equals(request.firstRideOnly()))
                .createdBy(actorUserId)
                .build());
    auditService.record(
        actorUserId, "promo.create", "promo", promo.getId().toString(), null, snapshot(promo));
    return promoDto(promo);
  }

  @Override
  @Transactional(readOnly = true)
  public PromoPageDto listPromos(
      UUID regionId, Boolean active, Boolean running, int page, int size) {
    Page<Promo> result =
        promoRepository.adminList(
            regionId, active, running, clock.instant(), PageRequest.of(page, size));
    return new PromoPageDto(
        result.getContent().stream().map(this::promoDto).toList(),
        page,
        size,
        result.getTotalElements());
  }

  @Override
  @Transactional(readOnly = true)
  public PromoDetailDto promoDetail(UUID promoId, int page, int size) {
    Promo promo =
        promoRepository
            .findById(promoId)
            .orElseThrow(() -> new ResourceNotFoundException("Promo", promoId));
    Page<PromoRedemption> redemptions =
        promoRedemptionRepository.findByPromoIdOrderByCreatedAtDesc(
            promoId, PageRequest.of(page, size));
    Map<UUID, String> names =
        userRepository
            .findAllById(redemptions.getContent().stream().map(PromoRedemption::getUserId).toList())
            .stream()
            .collect(Collectors.toMap(User::getId, User::getName));
    return new PromoDetailDto(
        promoDto(promo),
        new PromoDetailDto.RedemptionPageDto(
            redemptions.getContent().stream()
                .map(
                    redemption ->
                        new PromoDetailDto.PromoRedemptionDto(
                            redemption.getId(),
                            redemption.getUserId(),
                            names.getOrDefault(redemption.getUserId(), ""),
                            redemption.getRideId(),
                            redemption.getAmount(),
                            redemption.getCurrency(),
                            redemption.getCreatedAt()))
                .toList(),
            page,
            size,
            redemptions.getTotalElements()));
  }

  @Override
  @Transactional
  public PromoDto patchPromo(UUID actorUserId, UUID promoId, PatchPromoRequestDto request) {
    Promo promo =
        promoRepository
            .findById(promoId)
            .orElseThrow(() -> new ResourceNotFoundException("Promo", promoId));
    Map<String, Object> before = snapshot(promo);
    if (request.regionId() != null) {
      if (!regionRepository.existsById(request.regionId())) {
        throw new ResourceNotFoundException("Region", request.regionId());
      }
      promo.setRegionId(request.regionId());
    }
    if (request.serviceTypeId() != null) {
      promo.setServiceTypeId(request.serviceTypeId());
    }
    if (request.maxDiscount() != null) {
      promo.setMaxDiscount(request.maxDiscount());
    }
    if (request.startsAt() != null) {
      promo.setStartsAt(request.startsAt());
    }
    if (request.endsAt() != null) {
      promo.setEndsAt(request.endsAt());
    }
    if (request.perUserLimit() != null) {
      promo.setPerUserLimit(request.perUserLimit());
    }
    if (request.totalCap() != null) {
      promo.setTotalCap(request.totalCap());
    }
    if (request.firstRideOnly() != null) {
      promo.setFirstRideOnly(request.firstRideOnly());
    }
    if (request.active() != null) {
      promo.setActive(request.active());
    }
    requireValidWindow(promo.getStartsAt(), promo.getEndsAt());
    promo = promoRepository.saveAndFlush(promo);
    auditService.record(
        actorUserId, "promo.update", "promo", promo.getId().toString(), before, snapshot(promo));
    return promoDto(promo);
  }

  @Override
  @Transactional
  public ChallengeDto createChallenge(UUID actorUserId, SaveChallengeRequestDto request) {
    requireValidWindow(request.startsAt(), request.endsAt());
    if (!regionRepository.existsById(request.regionId())) {
      throw new ResourceNotFoundException("Region", request.regionId());
    }
    Challenge challenge =
        challengeRepository.saveAndFlush(
            Challenge.builder()
                .regionId(request.regionId())
                .role(request.role())
                .titleEn(request.titleEn())
                .titleAr(request.titleAr())
                .goalType(request.goalType())
                .goalTarget(request.goalTarget())
                .rewardPoints(request.rewardPoints())
                .startsAt(request.startsAt())
                .endsAt(request.endsAt())
                .createdBy(actorUserId)
                .build());
    auditService.record(
        actorUserId,
        "challenge.create",
        "challenge",
        challenge.getId().toString(),
        null,
        snapshot(challenge));
    return challengeDto(challenge);
  }

  @Override
  @Transactional(readOnly = true)
  public ChallengePageDto listChallenges(UUID regionId, int page, int size) {
    Page<Challenge> result = challengeRepository.adminList(regionId, PageRequest.of(page, size));
    return new ChallengePageDto(
        result.getContent().stream().map(this::challengeDto).toList(),
        page,
        size,
        result.getTotalElements());
  }

  @Override
  @Transactional(readOnly = true)
  public ChallengeDetailDto challengeDetail(UUID challengeId, int page, int size) {
    Challenge challenge =
        challengeRepository
            .findById(challengeId)
            .orElseThrow(() -> new ResourceNotFoundException("Challenge", challengeId));
    var progress =
        challengeProgressRepository.findByChallengeIdOrderByProgressDescUpdatedAtAsc(
            challengeId, PageRequest.of(page, size));
    Map<UUID, String> names =
        userRepository
            .findAllById(progress.getContent().stream().map(p -> p.getUserId()).toList())
            .stream()
            .collect(Collectors.toMap(User::getId, User::getName));
    return new ChallengeDetailDto(
        challengeDto(challenge),
        new ChallengeDetailDto.ParticipationPageDto(
            progress.getContent().stream()
                .map(
                    row ->
                        new ChallengeDetailDto.ParticipantDto(
                            row.getUserId(),
                            names.getOrDefault(row.getUserId(), ""),
                            row.getProgress(),
                            row.getCompletedAt() != null,
                            row.getCompletedAt()))
                .toList(),
            page,
            size,
            progress.getTotalElements()));
  }

  @Override
  @Transactional
  public ChallengeDto endChallenge(UUID actorUserId, UUID challengeId) {
    Challenge challenge =
        challengeRepository
            .findById(challengeId)
            .orElseThrow(() -> new ResourceNotFoundException("Challenge", challengeId));
    if (challenge.getEndedAt() != null || !clock.instant().isBefore(challenge.getEndsAt())) {
      throw (ConflictException)
          new ConflictException("This challenge is already over").withCode("already_ended");
    }
    Map<String, Object> before = snapshot(challenge);
    challenge.setEndedAt(clock.instant());
    challenge = challengeRepository.saveAndFlush(challenge);
    auditService.record(
        actorUserId,
        "challenge.end",
        "challenge",
        challenge.getId().toString(),
        before,
        snapshot(challenge));
    return challengeDto(challenge);
  }

  private PromoDto promoDto(Promo promo) {
    return new PromoDto(
        promo.getId(),
        promo.getCode(),
        promo.getRegionId(),
        promo.getServiceTypeId(),
        promo.getType(),
        promo.getValue(),
        promo.getMaxDiscount(),
        promo.getStartsAt(),
        promo.getEndsAt(),
        promo.getPerUserLimit(),
        promo.getTotalCap(),
        promo.isFirstRideOnly(),
        promo.isActive(),
        promoRedemptionRepository.countingAgainstCap(promo.getId()),
        promoRedemptionRepository.appliedAmount(promo.getId()));
  }

  private ChallengeDto challengeDto(Challenge challenge) {
    return new ChallengeDto(
        challenge.getId(),
        challenge.getRegionId(),
        challenge.getRole(),
        challenge.getTitleEn(),
        challenge.getTitleAr(),
        challenge.getGoalType(),
        challenge.getGoalTarget(),
        challenge.getRewardPoints(),
        challenge.getStartsAt(),
        challenge.getEndsAt(),
        challenge.getEndedAt(),
        challengeProgressRepository.countByChallengeId(challenge.getId()),
        challengeProgressRepository.countByChallengeIdAndCompletedAtIsNotNull(challenge.getId()));
  }

  private static void requireValidWindow(java.time.Instant startsAt, java.time.Instant endsAt) {
    if (!endsAt.isAfter(startsAt)) {
      throw (BusinessRuleViolationException)
          new BusinessRuleViolationException("The window must end after it starts")
              .withCode("window_invalid");
    }
  }

  /** M13 review H2: EVERY editable field, so a cap/discount/restriction change is auditable. */
  private static Map<String, Object> snapshot(Promo promo) {
    Map<String, Object> state = new LinkedHashMap<>();
    state.put("code", promo.getCode());
    state.put("type", promo.getType().getValue());
    state.put("value", promo.getValue());
    state.put("regionId", promo.getRegionId());
    state.put("serviceTypeId", promo.getServiceTypeId());
    state.put("maxDiscount", promo.getMaxDiscount());
    state.put("startsAt", promo.getStartsAt());
    state.put("endsAt", promo.getEndsAt());
    state.put("perUserLimit", promo.getPerUserLimit());
    state.put("totalCap", promo.getTotalCap());
    state.put("firstRideOnly", promo.isFirstRideOnly());
    state.put("active", promo.isActive());
    return state;
  }

  private static Map<String, Object> snapshot(Challenge challenge) {
    Map<String, Object> state = new LinkedHashMap<>();
    state.put("regionId", challenge.getRegionId());
    state.put("role", challenge.getRole().getValue());
    state.put("titleEn", challenge.getTitleEn());
    state.put("titleAr", challenge.getTitleAr());
    state.put("goalType", challenge.getGoalType().getValue());
    state.put("goalTarget", challenge.getGoalTarget());
    state.put("rewardPoints", challenge.getRewardPoints());
    state.put("startsAt", challenge.getStartsAt());
    state.put("endsAt", challenge.getEndsAt());
    state.put("endedAt", challenge.getEndedAt());
    return state;
  }
}
