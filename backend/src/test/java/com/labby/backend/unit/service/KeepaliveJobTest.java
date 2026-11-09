package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.labby.backend.config.OpsProperties;
import com.labby.backend.service.KeepaliveJob;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class KeepaliveJobTest {

  private static final String URL = "https://demo.example.test/actuator/health";

  @Test
  void pingsTheConfiguredUrl() {
    RestClient.Builder builder = RestClient.builder();
    MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    server.expect(requestTo(URL)).andExpect(method(HttpMethod.GET)).andRespond(withSuccess());

    new KeepaliveJob(new OpsProperties(URL, 600), builder.build()).ping();

    server.verify();
  }

  @Test
  void doesNothingWhenNoUrlIsConfigured() {
    RestClient.Builder builder = RestClient.builder();
    MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    // No expectation: any request would fail verification.

    new KeepaliveJob(new OpsProperties("", 600), builder.build()).ping();
    new KeepaliveJob(new OpsProperties(null, 600), builder.build()).ping();

    server.verify();
  }

  @Test
  void swallowsFailures() {
    RestClient.Builder builder = RestClient.builder();
    MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    server.expect(requestTo(URL)).andRespond(withServerError());

    assertThatCode(() -> new KeepaliveJob(new OpsProperties(URL, 600), builder.build()).ping())
        .doesNotThrowAnyException();
    server.verify();
  }
}
