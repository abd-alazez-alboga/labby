package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.labby.backend.config.OtpProperties;
import com.labby.backend.enums.Language;
import com.labby.backend.enums.OtpPurpose;
import com.labby.backend.exception.GoneException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.TooManyRequestsException;
import com.labby.backend.model.OtpCode;
import com.labby.backend.repository.OtpCodeRepository;
import com.labby.backend.service.OtpServiceImpl;
import com.labby.backend.service.SmsSender;
import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import java.util.function.UnaryOperator;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/** Every AUTH-04 rule: 6 digits, hashing, expiry, attempts, cooldown, cap, purpose, consume. */
@ExtendWith(MockitoExtension.class)
class OtpServiceImplTest {

  private static final String PHONE = "+963900000100";
  private static final Pattern SIX_DIGITS = Pattern.compile("(\\d{6})");

  @Mock private OtpCodeRepository otpCodeRepository;
  @Mock private SmsSender smsSender;

  private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder(4);
  private OtpServiceImpl otpService;

  @BeforeEach
  void setUp() {
    otpService =
        new OtpServiceImpl(
            otpCodeRepository, smsSender, passwordEncoder, new OtpProperties(300, 5, 60, 5));
  }

  @Test
  @DisplayName("issues a 6-digit code, sends it by SMS, and stores only the bcrypt hash")
  void shouldStoreHashedSixDigitCodeWhenIssued() {
    when(otpCodeRepository.countByPhoneAndCreatedAtAfter(eq(PHONE), any())).thenReturn(0L);
    when(otpCodeRepository.findTopByPhoneAndPurposeOrderByCreatedAtDesc(PHONE, OtpPurpose.REGISTER))
        .thenReturn(Optional.empty());

    otpService.issue(PHONE, OtpPurpose.REGISTER, Language.EN);

    ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
    verify(smsSender).send(eq(PHONE), message.capture());
    Matcher matcher = SIX_DIGITS.matcher(message.getValue());
    assertThat(matcher.find()).isTrue();
    String code = matcher.group(1);

    ArgumentCaptor<OtpCode> saved = ArgumentCaptor.forClass(OtpCode.class);
    verify(otpCodeRepository).save(saved.capture());
    assertThat(saved.getValue().getCodeHash()).startsWith("$2").doesNotContain(code);
    assertThat(passwordEncoder.matches(code, saved.getValue().getCodeHash())).isTrue();
    assertThat(saved.getValue().getPurpose()).isEqualTo(OtpPurpose.REGISTER);
    assertThat(saved.getValue().getExpiresAt())
        .isBetween(Instant.now().plusSeconds(290), Instant.now().plusSeconds(310));
  }

  @Test
  @DisplayName("localizes the SMS template by recipient language")
  void shouldLocalizeMessageWhenLanguageArabic() {
    when(otpCodeRepository.countByPhoneAndCreatedAtAfter(eq(PHONE), any())).thenReturn(0L);
    when(otpCodeRepository.findTopByPhoneAndPurposeOrderByCreatedAtDesc(PHONE, OtpPurpose.TWO_FA))
        .thenReturn(Optional.empty());

    otpService.issue(PHONE, OtpPurpose.TWO_FA, Language.AR);

    ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
    verify(smsSender).send(eq(PHONE), message.capture());
    assertThat(message.getValue()).contains("رمز لبي");
  }

  @Test
  @DisplayName("M15-T4: the SMS keeps Western digits even on an Arabic default locale")
  void shouldKeepWesternDigitsWhateverTheDefaultLocale() {
    when(otpCodeRepository.countByPhoneAndCreatedAtAfter(eq(PHONE), any())).thenReturn(0L);
    when(otpCodeRepository.findTopByPhoneAndPurposeOrderByCreatedAtDesc(PHONE, OtpPurpose.TWO_FA))
        .thenReturn(Optional.empty());
    Locale previous = Locale.getDefault();
    try {
      Locale.setDefault(Locale.forLanguageTag("ar-EG"));
      otpService.issue(PHONE, OtpPurpose.TWO_FA, Language.AR);
    } finally {
      Locale.setDefault(previous);
    }

    ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
    verify(smsSender).send(eq(PHONE), message.capture());
    assertThat(message.getValue())
        .containsPattern("[0-9]")
        .doesNotContainPattern("[\\u0660-\\u0669]");
  }

  @Test
  @DisplayName("rejects the 6th code in an hour (cap) without sending")
  void shouldThrowTooManyRequestsWhenHourlyCapReached() {
    when(otpCodeRepository.countByPhoneAndCreatedAtAfter(eq(PHONE), any())).thenReturn(5L);

    assertThatThrownBy(() -> otpService.issue(PHONE, OtpPurpose.REGISTER, Language.EN))
        .isInstanceOf(TooManyRequestsException.class);
    verify(smsSender, never()).send(anyString(), anyString());
    verify(otpCodeRepository, never()).save(any());
  }

  @Test
  @DisplayName("rejects a resend inside the 60s cooldown without sending")
  void shouldThrowTooManyRequestsWhenInsideResendCooldown() {
    when(otpCodeRepository.countByPhoneAndCreatedAtAfter(eq(PHONE), any())).thenReturn(1L);
    when(otpCodeRepository.findTopByPhoneAndPurposeOrderByCreatedAtDesc(PHONE, OtpPurpose.REGISTER))
        .thenReturn(Optional.of(code(builder -> builder.createdAt(Instant.now()))));

    assertThatThrownBy(() -> otpService.issue(PHONE, OtpPurpose.REGISTER, Language.EN))
        .isInstanceOf(TooManyRequestsException.class);
    verify(smsSender, never()).send(anyString(), anyString());
  }

  @Test
  @DisplayName("issues again once the cooldown elapsed")
  void shouldIssueWhenCooldownElapsed() {
    when(otpCodeRepository.countByPhoneAndCreatedAtAfter(eq(PHONE), any())).thenReturn(1L);
    when(otpCodeRepository.findTopByPhoneAndPurposeOrderByCreatedAtDesc(PHONE, OtpPurpose.REGISTER))
        .thenReturn(
            Optional.of(code(builder -> builder.createdAt(Instant.now().minusSeconds(61)))));

    otpService.issue(PHONE, OtpPurpose.REGISTER, Language.EN);

    verify(smsSender).send(eq(PHONE), anyString());
    verify(otpCodeRepository).save(any(OtpCode.class));
  }

  @Test
  @DisplayName("validation answers Gone when no live code exists")
  void shouldThrowGoneWhenNoCodeExists() {
    when(otpCodeRepository.findTopByPhoneAndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(
            PHONE, OtpPurpose.REGISTER))
        .thenReturn(Optional.empty());

    assertThatThrownBy(() -> otpService.validateAndConsume(PHONE, OtpPurpose.REGISTER, "123456"))
        .isInstanceOf(GoneException.class);
  }

  @Test
  @DisplayName("validation answers Gone when the code expired (5-min expiry)")
  void shouldThrowGoneWhenCodeExpired() {
    when(otpCodeRepository.findTopByPhoneAndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(
            PHONE, OtpPurpose.REGISTER))
        .thenReturn(Optional.of(code(builder -> builder.expiresAt(Instant.now().minusSeconds(1)))));

    assertThatThrownBy(() -> otpService.validateAndConsume(PHONE, OtpPurpose.REGISTER, "123456"))
        .isInstanceOf(GoneException.class);
  }

  @Test
  @DisplayName("validation answers Gone once 5 attempts are used — even with the right code")
  void shouldThrowGoneWhenAttemptsExhausted() {
    when(otpCodeRepository.findTopByPhoneAndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(
            PHONE, OtpPurpose.REGISTER))
        .thenReturn(
            Optional.of(
                code(builder -> builder.codeHash(passwordEncoder.encode("123456")).attempts(5))));

    assertThatThrownBy(() -> otpService.validateAndConsume(PHONE, OtpPurpose.REGISTER, "123456"))
        .isInstanceOf(GoneException.class);
  }

  @Test
  @DisplayName("a wrong code counts an attempt and answers 400")
  void shouldCountAttemptWhenCodeWrong() {
    OtpCode stored = code(builder -> builder.codeHash(passwordEncoder.encode("654321")));
    when(otpCodeRepository.findTopByPhoneAndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(
            PHONE, OtpPurpose.REGISTER))
        .thenReturn(Optional.of(stored));

    assertThatThrownBy(() -> otpService.validateAndConsume(PHONE, OtpPurpose.REGISTER, "123456"))
        .isInstanceOf(InvalidRequestException.class);
    assertThat(stored.getAttempts()).isEqualTo(1);
    assertThat(stored.getConsumedAt()).isNull();
    verify(otpCodeRepository).save(stored);
  }

  @Test
  @DisplayName("a code NEVER validates for a different purpose (AUTH-04)")
  void shouldThrowGoneWhenPurposeMismatch() {
    // A live register code exists, but the caller validates purpose=reset: the lookup is
    // purpose-bound, so no code is found for reset.
    when(otpCodeRepository.findTopByPhoneAndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(
            PHONE, OtpPurpose.RESET))
        .thenReturn(Optional.empty());

    assertThatThrownBy(() -> otpService.validateAndConsume(PHONE, OtpPurpose.RESET, "123456"))
        .isInstanceOf(GoneException.class);
    verify(otpCodeRepository)
        .findTopByPhoneAndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(PHONE, OtpPurpose.RESET);
    verify(otpCodeRepository, never())
        .findTopByPhoneAndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(
            PHONE, OtpPurpose.REGISTER);
  }

  @Test
  @DisplayName("a correct code is consumed and cannot be used twice")
  void shouldConsumeOnceWhenCodeCorrect() {
    OtpCode stored = code(builder -> builder.codeHash(passwordEncoder.encode("123456")));
    when(otpCodeRepository.findTopByPhoneAndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(
            PHONE, OtpPurpose.REGISTER))
        .thenReturn(Optional.of(stored));

    otpService.validateAndConsume(PHONE, OtpPurpose.REGISTER, "123456");
    assertThat(stored.getConsumedAt()).isNotNull();
    verify(otpCodeRepository).save(stored);

    // Consumed codes are filtered out by the lookup -> second use is Gone.
    when(otpCodeRepository.findTopByPhoneAndPurposeAndConsumedAtIsNullOrderByCreatedAtDesc(
            PHONE, OtpPurpose.REGISTER))
        .thenReturn(Optional.empty());
    assertThatThrownBy(() -> otpService.validateAndConsume(PHONE, OtpPurpose.REGISTER, "123456"))
        .isInstanceOf(GoneException.class);
  }

  private OtpCode code(UnaryOperator<OtpCode.OtpCodeBuilder> customizer) {
    OtpCode.OtpCodeBuilder builder =
        OtpCode.builder()
            .phone(PHONE)
            .purpose(OtpPurpose.REGISTER)
            .codeHash("$2a$04$unused")
            .attempts(0)
            .createdAt(Instant.now())
            .expiresAt(Instant.now().plusSeconds(300));
    return customizer.apply(builder).build();
  }
}
