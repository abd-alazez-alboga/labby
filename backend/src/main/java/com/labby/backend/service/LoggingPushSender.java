package com.labby.backend.service;

import java.util.List;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;

/**
 * The push sender used when no Firebase credentials are configured (local dev, tests): logs that a
 * push was skipped and reports nothing delivered, so the center row records {@code failed} rather
 * than claiming a delivery that never happened. Message text is never logged.
 */
@Slf4j
public class LoggingPushSender implements PushSender {

  @Override
  public PushResult send(List<String> tokens, PushMessage message) {
    log.info(
        "FCM not configured: push for event {} to {} device(s) not sent",
        message.data().get("event"),
        tokens.size());
    return new PushResult(0, Set.of());
  }
}
