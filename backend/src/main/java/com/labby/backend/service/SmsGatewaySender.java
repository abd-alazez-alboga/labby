package com.labby.backend.service;

import com.labby.backend.config.SmsProperties;
import com.labby.backend.exception.SmsDeliveryException;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Token-authenticated HTTP call to the owner-operated Traccar SMS Gateway app (ES-01): POST {@code
 * SMS_GATEWAY_URL} with body {@code {to, message}} and the raw token in the Authorization header
 * (Traccar's HTTP SMS API uses no Bearer prefix). Message bodies are never logged — they carry
 * OTPs.
 */
@Slf4j
@Service
public class SmsGatewaySender implements SmsSender {

  private final RestClient restClient;

  public SmsGatewaySender(SmsProperties smsProperties, RestClient.Builder restClientBuilder) {
    this.restClient =
        restClientBuilder
            .baseUrl(smsProperties.gatewayUrl())
            .defaultHeader(HttpHeaders.AUTHORIZATION, smsProperties.gatewayToken())
            .build();
  }

  @Override
  public void send(String phone, String message) {
    try {
      restClient
          .post()
          .contentType(MediaType.APPLICATION_JSON)
          .body(Map.of("to", phone, "message", message))
          .retrieve()
          .toBodilessEntity();
    } catch (RestClientException ex) {
      log.warn("SMS gateway send failed for phone {}: {}", phone, ex.getClass().getSimpleName());
      throw new SmsDeliveryException("SMS delivery failed; please try again later", ex);
    }
  }
}
