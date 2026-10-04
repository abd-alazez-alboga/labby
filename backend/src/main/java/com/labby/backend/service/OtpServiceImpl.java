package com.labby.backend.service;

import com.labby.backend.config.OtpProperties;
import com.labby.backend.enums.Language;
import com.labby.backend.enums.OtpPurpose;
import com.labby.backend.exception.GoneException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.TooManyRequestsException;
import com.labby.backend.model.OtpCode;
import com.labby.backend.repository.OtpCodeRepository;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * AUTH-04 enforcement. Codes are random 6-digit values, stored bcrypt-hashed, purpose-bound,
 * expiring, attempt-limited, rate-limited, and consumed on success. The plain code is never logged
 * and never leaves the process except inside the SMS body.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class OtpServiceImpl implements OtpService {

  private static final SecureRandom RANDOM = new SecureRandom();

  private final OtpCodeRepository otpCodeRepository;
  private final SmsSender smsSender;
  private final PasswordEncoder passwordEncoder;
  private final OtpProperties otpProperties;

  @Override
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void issue(String phone, OtpPurpose purpose, Language language) {
    Instant now = Instant.now();

    long sentLastHour =
        otpCodeRepository.countByPhoneAndCreatedAtAfter(phone, now.minus(Duration.ofHours(1)));
    if (sentLastHour >= otpProperties.maxPerPhonePerHour()) {
      throw new TooManyRequestsException("Too many codes requested for this phone; try later");
    }

    otpCodeRepository
        .findTopByPhoneAndPurposeOrderByCreatedAtDesc(phone, purpose)
        .filter(
            latest ->
                latest
                    .getCreatedAt()
                    .isAfter(now.minusSeconds(otpProperties.resendCooldownSeconds())))
        .ifPresent(
            latest -> {
              throw new TooManyRequestsException("Please wait before requesting a new code");
            });

    String code = "%06d".formatted(RANDOM.nextInt(1_000_000));
    smsSender.send(phone, buildMessage(code, language));

    otpCodeRepository.save(
        OtpCode.builder()
            .phone(phone)
            .purpose(purpose)
            .codeHash(passwordEncoder.encode(code))
            .expiresAt(now.plusSeconds(otpProperties.expirySeconds()))
            .build());
  }

  @Override
  @Transactional(
      propagation = Propagation.REQUIRES_NEW,
      noRollbackFor = {InvalidRequestException.class, GoneException.class})
  public void validateAndConsume(String phone, OtpPurpose purpose, String code) {
    OtpCode otpCode =
        otpCodeRepository
            .findTopByPhoneAndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(phone, purpose)
            .orElseThrow(() -> new GoneException("Code expired or not found; request a new one"));

    if (otpCode.getExpiresAt().isBefore(Instant.now())) {
      throw new GoneException("Code expired; request a new one");
    }
    if (otpCode.getAttempts() >= otpProperties.maxAttempts()) {
      throw new GoneException("Too many wrong attempts; request a new code");
    }
    if (!passwordEncoder.matches(code, otpCode.getCodeHash())) {
      otpCode.setAttempts(otpCode.getAttempts() + 1);
      otpCodeRepository.save(otpCode);
      throw new InvalidRequestException("Wrong code");
    }

    otpCode.setConsumedAt(Instant.now());
    otpCodeRepository.save(otpCode);
  }

  private String buildMessage(String code, Language language) {
    long minutes = Math.max(1, otpProperties.expirySeconds() / 60);
    if (language == Language.AR) {
      return "رمز التحقق الخاص بك في لابي هو %s. صالح لمدة %d دقائق.".formatted(code, minutes);
    }
    return "%s is your Labby verification code. It expires in %d minutes.".formatted(code, minutes);
  }
}
