package com.labby.backend.service;

import com.labby.backend.config.NotificationProperties;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * SAFE-01 "instant to admins": once an SOS commits, one outbox pass runs at once on the async
 * executor instead of waiting up to a dispatcher tick. The pass is the ordinary one (claims keep it
 * safe beside the scheduled pass and other instances; SOS entries are picked first). It follows the
 * dispatcher's switch: with {@code labby.notifications.dispatch-cron} set to {@code -} (tests drive
 * the dispatcher directly) nothing is started.
 */
@Component
public class SosAlertDispatchListener {

  private final NotificationDispatchService notificationDispatchService;
  private final boolean dispatcherEnabled;

  /**
   * Wires the listener.
   *
   * @param notificationDispatchService the outbox dispatcher
   * @param notificationProperties the dispatcher switch
   */
  public SosAlertDispatchListener(
      NotificationDispatchService notificationDispatchService,
      NotificationProperties notificationProperties) {
    this.notificationDispatchService = notificationDispatchService;
    this.dispatcherEnabled = !"-".equals(notificationProperties.dispatchCron());
  }

  /**
   * Runs one dispatch pass after the SOS transaction committed.
   *
   * @param event the committed SOS
   */
  @Async
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onSosTriggered(SosTriggeredEvent event) {
    if (dispatcherEnabled) {
      notificationDispatchService.dispatchPending();
    }
  }
}
