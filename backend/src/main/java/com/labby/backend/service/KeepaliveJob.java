package com.labby.backend.service;

import com.labby.backend.config.OpsProperties;
import java.net.http.HttpClient;
import java.time.Duration;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Keeps a free-tier instance awake: every {@code labby.ops.keepalive-interval-seconds} it requests
 * {@code labby.ops.keepalive-url} ({@code KEEPALIVE_URL}) — the instance's own public health URL,
 * so the request travels through the host's proxy and counts as inbound traffic (Render free
 * instances idle out after 15 min without any). Blank URL = no-op; failures are logged, never
 * thrown. Replaces the GitHub Actions cron, which GitHub fires hours apart on a private repo.
 */
@Component
@Slf4j
public class KeepaliveJob {

  private static final Duration TIMEOUT = Duration.ofSeconds(30);

  private final OpsProperties properties;
  private final RestClient restClient;

  @Autowired
  public KeepaliveJob(OpsProperties properties, RestClient.Builder restClientBuilder) {
    this(properties, restClientBuilder.clone().requestFactory(requestFactory()).build());
  }

  /** Testing seam: a client whose transport the test controls. */
  public KeepaliveJob(OpsProperties properties, RestClient restClient) {
    this.properties = properties;
    this.restClient = restClient;
  }

  private static JdkClientHttpRequestFactory requestFactory() {
    JdkClientHttpRequestFactory requestFactory =
        new JdkClientHttpRequestFactory(
            HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(TIMEOUT)
                .build());
    requestFactory.setReadTimeout(TIMEOUT);
    return requestFactory;
  }

  /** One keepalive request, when configured. */
  @Scheduled(
      fixedDelayString = "${labby.ops.keepalive-interval-seconds}",
      initialDelayString = "${labby.ops.keepalive-interval-seconds}",
      timeUnit = java.util.concurrent.TimeUnit.SECONDS)
  public void ping() {
    if (!properties.keepaliveEnabled()) {
      return;
    }
    try {
      restClient.get().uri(properties.keepaliveUrl()).retrieve().toBodilessEntity();
      log.debug("keepalive ping ok");
    } catch (RuntimeException ex) {
      log.warn("keepalive ping failed ({})", ex.getClass().getSimpleName());
    }
  }
}
