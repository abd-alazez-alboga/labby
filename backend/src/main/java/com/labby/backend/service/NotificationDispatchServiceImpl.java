package com.labby.backend.service;

import com.labby.backend.enums.PushStatus;
import com.labby.backend.service.NotificationDeliveryWriter.Delivery;
import com.labby.backend.service.PushSender.PushResult;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * Outbox dispatcher: per entry, (1) commit the center row ({@link
 * NotificationDeliveryWriter#prepare}), (2) push outside any transaction, (3) record the outcome
 * and mark the entry delivered. A push that throws is recorded as {@code failed}; the center row is
 * already committed (NFR-A3).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NotificationDispatchServiceImpl implements NotificationDispatchService {

  /** Entries per run; a backlog drains over consecutive runs. */
  static final int BATCH_SIZE = 200;

  private final NotificationDeliveryWriter notificationDeliveryWriter;
  private final PushSender pushSender;

  @Override
  public int dispatchPending() {
    int delivered = 0;
    for (UUID outboxId : notificationDeliveryWriter.pendingOutboxIds(BATCH_SIZE)) {
      try {
        if (deliver(outboxId)) {
          delivered++;
        }
      } catch (RuntimeException ex) {
        log.error(
            "Notification delivery failed for outbox entry {}; retrying next run", outboxId, ex);
      }
    }
    return delivered;
  }

  private boolean deliver(UUID outboxId) {
    Optional<Delivery> prepared = notificationDeliveryWriter.prepare(outboxId);
    if (prepared.isEmpty()) {
      return false;
    }
    Delivery delivery = prepared.get();
    if (delivery.decided() != null) {
      notificationDeliveryWriter.complete(delivery, delivery.decided(), Set.of());
      return true;
    }
    PushStatus status;
    Set<String> deadTokens = Set.of();
    try {
      PushResult result = pushSender.send(delivery.tokens(), delivery.message());
      status = result.anyDelivered() ? PushStatus.SENT : PushStatus.FAILED;
      deadTokens = result.invalidTokens();
    } catch (RuntimeException ex) {
      log.warn("Push failed for notification {}: {}", delivery.notificationId(), ex.getMessage());
      status = PushStatus.FAILED;
    }
    notificationDeliveryWriter.complete(delivery, status, deadTokens);
    return true;
  }
}
