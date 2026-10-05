package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.labby.backend.config.SmsProperties;
import com.labby.backend.exception.SmsDeliveryException;
import com.labby.backend.service.SmsGatewaySender;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** Pins the Traccar HTTP SMS API request shape: raw token auth, {to, message} body. */
class SmsGatewaySenderTest {

  private static final String URL = "https://sms.gateway.test/sms/";
  private static final String TOKEN = "test-token";

  private MockRestServiceServer server;
  private SmsGatewaySender sender;

  @BeforeEach
  void setUp() {
    RestClient.Builder builder = RestClient.builder();
    server = MockRestServiceServer.bindTo(builder).build();
    sender = new SmsGatewaySender(new SmsProperties(URL, TOKEN), builder);
  }

  @Test
  @DisplayName("posts {to, message} with the raw token in Authorization (no Bearer prefix)")
  void sendsTraccarShapedRequest() {
    server
        .expect(requestTo(URL))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header(HttpHeaders.AUTHORIZATION, TOKEN))
        .andExpect(jsonPath("$.to").value("+963900000001"))
        .andExpect(jsonPath("$.message").value("Labby code: 123456"))
        .andRespond(withSuccess());

    assertThatCode(() -> sender.send("+963900000001", "Labby code: 123456"))
        .doesNotThrowAnyException();
    server.verify();
  }

  @Test
  @DisplayName("gateway failure surfaces as SmsDeliveryException without leaking the message")
  void wrapsGatewayFailure() {
    server.expect(requestTo(URL)).andRespond(withServerError());

    assertThatThrownBy(() -> sender.send("+963900000001", "Labby code: 123456"))
        .isInstanceOf(SmsDeliveryException.class)
        .hasMessageNotContaining("123456");
    server.verify();
  }
}
