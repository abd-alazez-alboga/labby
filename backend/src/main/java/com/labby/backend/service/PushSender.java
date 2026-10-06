package com.labby.backend.service;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Outbound push seam (ES-03). The runtime implementation is FCM ({@link FcmPushSender}) when
 * Firebase credentials are configured, otherwise {@link LoggingPushSender} (dev/tests without
 * credentials). The notification dispatcher calls it OUTSIDE any transaction, after the
 * notification-center row is committed, so a push failure never loses the center record (NFR-A3).
 */
public interface PushSender {

  /**
   * Sends one message to each token.
   *
   * @param tokens the FCM registration tokens (one account's devices of one audience)
   * @param message the localized message
   * @return how many devices accepted it and which tokens are permanently invalid (to prune)
   * @throws RuntimeException on a transport-level failure; the caller records the push as failed
   */
  PushResult send(List<String> tokens, PushMessage message);

  /**
   * A localized push.
   *
   * @param title the title in the recipient's language
   * @param body the body in the recipient's language
   * @param data string key/values for the client (notification id, category, event, deep link)
   */
  record PushMessage(String title, String body, Map<String, String> data) {}

  /**
   * The outcome of one send.
   *
   * @param delivered number of tokens the push service accepted the message for
   * @param invalidTokens tokens the push service reported unregistered/invalid — delete them
   */
  record PushResult(int delivered, Set<String> invalidTokens) {

    /**
     * Whether at least one device accepted the message.
     *
     * @return true when delivered to any device
     */
    public boolean anyDelivered() {
      return delivered > 0;
    }
  }
}
