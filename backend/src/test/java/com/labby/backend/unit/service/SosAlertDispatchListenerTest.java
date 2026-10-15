package com.labby.backend.unit.service;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import com.labby.backend.config.NotificationProperties;
import com.labby.backend.service.NotificationDispatchService;
import com.labby.backend.service.SosAlertDispatchListener;
import com.labby.backend.service.SosTriggeredEvent;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** M10 review B-W4: the after-commit SOS dispatch pass follows the dispatcher's own switch. */
class SosAlertDispatchListenerTest {

  private final NotificationDispatchService dispatchService =
      mock(NotificationDispatchService.class);

  @Test
  @DisplayName("an SOS commit starts one dispatch pass while the dispatcher is enabled")
  void shouldDispatchAtOnceWhenEnabled() {
    new SosAlertDispatchListener(dispatchService, properties("*/5 * * * * *"))
        .onSosTriggered(new SosTriggeredEvent(UUID.randomUUID()));

    verify(dispatchService).dispatchPending();
  }

  @Test
  @DisplayName("nothing is started when the dispatcher is disabled (\"-\")")
  void shouldStayIdleWhenDisabled() {
    new SosAlertDispatchListener(dispatchService, properties("-"))
        .onSosTriggered(new SosTriggeredEvent(UUID.randomUUID()));

    verifyNoInteractions(dispatchService);
  }

  private static NotificationProperties properties(String dispatchCron) {
    return new NotificationProperties(dispatchCron, "", "");
  }
}
