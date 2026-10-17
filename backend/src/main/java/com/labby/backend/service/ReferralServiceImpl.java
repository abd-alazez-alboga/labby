package com.labby.backend.service;

import com.labby.backend.dto.ReferralStatusDto;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Referral;
import com.labby.backend.model.ReferralCode;
import com.labby.backend.model.User;
import com.labby.backend.repository.ReferralCodeRepository;
import com.labby.backend.repository.ReferralRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.UserRepository;
import java.security.SecureRandom;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** GRW-03 (owner ruling 6, 2026-10-18): the abuse blocks live here and at the database. */
@Service
@RequiredArgsConstructor
public class ReferralServiceImpl implements ReferralService {

  /** No 0/O/1/I/L: codes are read aloud and typed. */
  private static final String ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  private static final int CODE_LENGTH = 8;

  private final ReferralCodeRepository referralCodeRepository;
  private final ReferralRepository referralRepository;
  private final RideRepository rideRepository;
  private final UserRepository userRepository;
  private final RideAccess rideAccess;
  private final SecureRandom random = new SecureRandom();

  @Override
  @Transactional
  public ReferralStatusDto me(UUID userId) {
    rideAccess.requireRider(userId);
    return status(userId);
  }

  @Override
  @Transactional
  public ReferralStatusDto enter(UUID userId, String code) {
    rideAccess.requireRider(userId);
    ReferralCode shared =
        referralCodeRepository
            .findByCode(code.trim().toUpperCase(Locale.ROOT))
            .orElseThrow(
                () ->
                    (ResourceNotFoundException)
                        new ResourceNotFoundException("This referral code does not exist")
                            .withCode("referral_code_not_found"));
    if (shared.getUserId().equals(userId)) {
      throw conflict("You cannot enter your own code", "referral_self");
    }
    if (referralRepository.findByRefereeUserId(userId).isPresent()) {
      throw conflict("You already entered a referral code", "referral_already_entered");
    }
    if (rideRepository.riderCompletedCount(userId) > 0) {
      throw conflict(
          "Referral codes can only be entered before your first ride", "referral_too_late");
    }
    String phone = userRepository.findById(userId).orElseThrow().getPhone();
    if (referralRepository.existsByRefereePhone(phone)) {
      // Ruling 6: once per phone number, EVER — a reactivated account never re-enters.
      throw conflict("A referral was already used with this phone number", "referral_phone_used");
    }
    try {
      referralRepository.saveAndFlush(
          Referral.builder()
              .referrerUserId(shared.getUserId())
              .refereeUserId(userId)
              .refereePhone(phone)
              .build());
    } catch (DataIntegrityViolationException ex) {
      throw conflict("A referral was already used with this phone number", "referral_phone_used");
    }
    return status(userId);
  }

  private ReferralStatusDto status(UUID userId) {
    String ownCode = codeOf(userId);
    String enteredCode =
        referralRepository
            .findByRefereeUserId(userId)
            .map(referral -> codeOf(referral.getReferrerUserId()))
            .orElse(null);
    List<Referral> referees = referralRepository.findByReferrerUserIdOrderByCreatedAtDesc(userId);
    Map<UUID, String> names =
        userRepository
            .findAllById(referees.stream().map(Referral::getRefereeUserId).toList())
            .stream()
            .collect(
                Collectors.toMap(User::getId, user -> RideAssembler.firstName(user.getName())));
    return new ReferralStatusDto(
        ownCode,
        enteredCode,
        referees.stream()
            .map(
                referral ->
                    new ReferralStatusDto.RefereeDto(
                        names.getOrDefault(referral.getRefereeUserId(), ""),
                        referral.getStatus(),
                        referral.getCreatedAt(),
                        referral.getRewardedAt()))
            .toList());
  }

  /** The user's share code, created lazily; collisions retry, a creation race re-reads. */
  private String codeOf(UUID userId) {
    return referralCodeRepository
        .findById(userId)
        .map(ReferralCode::getCode)
        .orElseGet(
            () -> {
              String code = randomCode();
              while (referralCodeRepository.existsByCode(code)) {
                code = randomCode();
              }
              try {
                return referralCodeRepository
                    .saveAndFlush(ReferralCode.builder().userId(userId).code(code).build())
                    .getCode();
              } catch (DataIntegrityViolationException ex) {
                return referralCodeRepository
                    .findById(userId)
                    .map(ReferralCode::getCode)
                    .orElseThrow(() -> ex);
              }
            });
  }

  private String randomCode() {
    StringBuilder code = new StringBuilder(CODE_LENGTH);
    for (int i = 0; i < CODE_LENGTH; i++) {
      code.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
    }
    return code.toString();
  }

  private static ConflictException conflict(String message, String code) {
    return (ConflictException) new ConflictException(message).withCode(code);
  }
}
