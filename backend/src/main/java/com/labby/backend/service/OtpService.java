package com.labby.backend.service;

import com.labby.backend.enums.Language;
import com.labby.backend.enums.OtpPurpose;

/** Issues and validates one-time codes under the AUTH-04 policy. */
public interface OtpService {

  /**
   * Generates, sends, and stores (hashed) a 6-digit code for the phone and purpose.
   *
   * @param phone the recipient phone
   * @param purpose the operation the code authorizes; it is valid only for this purpose
   * @param language the recipient's language for the SMS template (EN when unknown)
   * @throws com.labby.backend.exception.TooManyRequestsException on resend cooldown or hourly cap
   * @throws com.labby.backend.exception.SmsDeliveryException when the SMS cannot be sent
   */
  void issue(String phone, OtpPurpose purpose, Language language);

  /**
   * Validates a code for the phone and purpose and consumes it on success. A code issued for a
   * different purpose never validates (AUTH-04).
   *
   * @param phone the phone the code was sent to
   * @param purpose the purpose the caller is authorizing
   * @param code the 6-digit code
   * @throws com.labby.backend.exception.InvalidRequestException on a wrong code (attempt counted)
   * @throws com.labby.backend.exception.GoneException when no live code exists, the code expired,
   *     was already consumed, or its attempts are exhausted
   */
  void validateAndConsume(String phone, OtpPurpose purpose, String code);
}
