package com.labby.backend.service;

/**
 * Outbound SMS seam (ES-01). The single runtime implementation talks to the owner-operated gateway;
 * ALL environments send real SMS — there is no mock or log sender in runtime code. Tests stub this
 * interface at the boundary via {@code @MockitoBean}.
 */
public interface SmsSender {

  /**
   * Sends one SMS.
   *
   * @param phone the recipient phone in E.164-ish form
   * @param message the full localized message body
   * @throws com.labby.backend.exception.SmsDeliveryException when the gateway fails the send
   */
  void send(String phone, String message);
}
