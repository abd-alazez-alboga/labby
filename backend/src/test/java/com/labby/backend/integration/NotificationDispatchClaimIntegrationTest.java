package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.service.NotificationDeliveryWriter;
import com.labby.backend.service.NotificationDispatchService;
import com.labby.backend.service.NotificationService;
import com.labby.backend.service.PushSender;
import com.labby.backend.service.PushSender.PushMessage;
import com.labby.backend.service.PushSender.PushResult;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Review M6 W4 (NFR-P4): the outbox dispatcher is safe with more than one backend instance. Each
 * entry is claimed together with its center row before the push, so concurrent dispatcher passes
 * push every entry exactly once; a claim left by an instance that died mid-push goes stale after
 * {@link NotificationDeliveryWriter#CLAIM_TIMEOUT} and the entry is delivered then. {@link
 * PushSender} is mocked at the boundary (slow, so the passes overlap during the push).
 */
class NotificationDispatchClaimIntegrationTest extends AbstractOnboardingIntegrationTest {

  private static final int ENTRIES = 6;

  @MockitoBean private PushSender pushSender;

  @Autowired private NotificationDispatchService notificationDispatchService;
  @Autowired private NotificationDeliveryWriter notificationDeliveryWriter;
  @Autowired private NotificationService notificationService;

  private final Queue<String> pushedNotificationIds = new ConcurrentLinkedQueue<>();

  @BeforeEach
  void slowPushSucceeds() {
    pushedNotificationIds.clear();
    Mockito.reset(pushSender);
    when(pushSender.send(anyList(), any()))
        .thenAnswer(
            invocation -> {
              PushMessage message = invocation.getArgument(1);
              pushedNotificationIds.add(message.data().get("notificationId"));
              Thread.sleep(150);
              return new PushResult(invocation.<List<?>>getArgument(0).size(), Set.of());
            });
  }

  private Account driverWithDevice(String phone, String token) {
    Account account = registerWithoutPhoto(phone, "Driver " + phone);
    HttpHeaders headers = bearer(account.token());
    headers.setContentType(MediaType.APPLICATION_JSON);
    assertThat(
            restTemplate
                .exchange(
                    "/api/v1/devices",
                    HttpMethod.PUT,
                    new HttpEntity<>(
                        Map.of("token", token, "platform", "android", "app", "driver"), headers),
                    Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    return account;
  }

  @Test
  @DisplayName("two concurrent dispatcher passes over the same rows push each exactly once")
  void shouldPushEachEntryOnceAcrossConcurrentPasses() throws Exception {
    Account driver = driverWithDevice("+963938100001", "fcm-concurrent");
    for (int i = 0; i < ENTRIES; i++) {
      notificationService.queue(driver.userId(), NotificationEvent.DRIVER_REINSTATED);
    }

    List<Integer> delivered =
        concurrently(
            notificationDispatchService::dispatchPending,
            notificationDispatchService::dispatchPending);

    assertThat(delivered.get(0) + delivered.get(1)).isEqualTo(ENTRIES);
    assertThat(pushedNotificationIds).hasSize(ENTRIES);
    assertThat(new HashSet<>(pushedNotificationIds)).hasSize(ENTRIES);
    assertThat(
            jdbcTemplate.queryForList(
                "SELECT push_status FROM notifications WHERE user_id = ?",
                String.class,
                driver.userId()))
        .hasSize(ENTRIES)
        .containsOnly("sent");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM notification_outbox WHERE user_id = ?"
                    + " AND delivered_at IS NULL",
                Integer.class,
                driver.userId()))
        .isZero();
  }

  @Test
  @DisplayName("a claim left by a dead instance blocks re-push until it goes stale, then delivers")
  void shouldRetryAStaleClaimOnce() {
    Account driver = driverWithDevice("+963938100002", "fcm-stale");
    notificationService.queue(driver.userId(), NotificationEvent.DRIVER_REINSTATED);
    UUID outboxId =
        jdbcTemplate.queryForObject(
            "SELECT notification_outbox_id FROM notification_outbox WHERE user_id = ?",
            UUID.class,
            driver.userId());
    // Another instance claimed the entry and wrote the center row, then died before completing.
    assertThat(notificationDeliveryWriter.prepare(outboxId)).isPresent();

    assertThat(notificationDispatchService.dispatchPending()).isZero();
    verify(pushSender, never()).send(anyList(), any());

    jdbcTemplate.update(
        "UPDATE notification_outbox SET claimed_at = claimed_at - ? * interval '1 second'"
            + " WHERE notification_outbox_id = ?",
        NotificationDeliveryWriter.CLAIM_TIMEOUT.toSeconds() + 1,
        outboxId);

    assertThat(notificationDispatchService.dispatchPending()).isEqualTo(1);
    verify(pushSender, times(1)).send(Mockito.eq(List.of("fcm-stale")), any());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT push_status FROM notifications WHERE user_id = ?",
                String.class,
                driver.userId()))
        .isEqualTo("sent");
    assertThat(notificationDispatchService.dispatchPending()).isZero();
  }

  /** Runs the calls at the same instant on separate threads and returns their results in order. */
  @SafeVarargs
  private static <T> List<T> concurrently(Callable<T>... calls) throws Exception {
    ExecutorService executor = Executors.newFixedThreadPool(calls.length);
    try {
      CountDownLatch start = new CountDownLatch(1);
      List<Future<T>> futures = new ArrayList<>();
      for (Callable<T> call : calls) {
        futures.add(
            executor.submit(
                () -> {
                  start.await();
                  return call.call();
                }));
      }
      start.countDown();
      List<T> results = new ArrayList<>();
      for (Future<T> future : futures) {
        results.add(future.get());
      }
      return results;
    } finally {
      executor.shutdownNow();
    }
  }
}
