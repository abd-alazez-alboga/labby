package com.labby.backend.service;

import com.google.firebase.messaging.BatchResponse;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.MessagingErrorCode;
import com.google.firebase.messaging.MulticastMessage;
import com.google.firebase.messaging.Notification;
import com.google.firebase.messaging.SendResponse;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * FCM push via the Firebase Admin SDK (ES-03). One multicast per notification; per-token failures
 * that mean the token is dead (unregistered, invalid, wrong sender) are reported back so the
 * dispatcher prunes them. Message text is never logged.
 */
@Slf4j
@RequiredArgsConstructor
public class FcmPushSender implements PushSender {

  /** FCM's multicast limit. */
  static final int MAX_TOKENS_PER_CALL = 500;

  private final FirebaseMessaging firebaseMessaging;

  @Override
  public PushResult send(List<String> tokens, PushMessage message) {
    int delivered = 0;
    Set<String> invalid = new HashSet<>();
    for (int from = 0; from < tokens.size(); from += MAX_TOKENS_PER_CALL) {
      List<String> chunk =
          tokens.subList(from, Math.min(tokens.size(), from + MAX_TOKENS_PER_CALL));
      BatchResponse batch = sendChunk(chunk, message);
      List<SendResponse> responses = batch.getResponses();
      for (int i = 0; i < responses.size(); i++) {
        SendResponse response = responses.get(i);
        if (response.isSuccessful()) {
          delivered++;
        } else if (isDeadToken(response.getException())) {
          invalid.add(chunk.get(i));
        } else {
          log.warn(
              "FCM rejected a push for event {}: {}",
              message.data().get("event"),
              errorCode(response.getException()));
        }
      }
    }
    return new PushResult(delivered, invalid);
  }

  private BatchResponse sendChunk(List<String> chunk, PushMessage message) {
    MulticastMessage multicast =
        MulticastMessage.builder()
            .setNotification(
                Notification.builder().setTitle(message.title()).setBody(message.body()).build())
            .putAllData(message.data())
            .addAllTokens(chunk)
            .build();
    try {
      return firebaseMessaging.sendEachForMulticast(multicast);
    } catch (FirebaseMessagingException ex) {
      throw new IllegalStateException("FCM send failed: " + errorCode(ex), ex);
    }
  }

  /**
   * Whether FCM's per-token error means the token can never receive again.
   *
   * @param exception the per-token failure, may be null
   * @return true for unregistered, invalid or foreign-project tokens
   */
  static boolean isDeadToken(FirebaseMessagingException exception) {
    if (exception == null || exception.getMessagingErrorCode() == null) {
      return false;
    }
    MessagingErrorCode code = exception.getMessagingErrorCode();
    return code == MessagingErrorCode.UNREGISTERED
        || code == MessagingErrorCode.INVALID_ARGUMENT
        || code == MessagingErrorCode.SENDER_ID_MISMATCH;
  }

  private static String errorCode(FirebaseMessagingException exception) {
    if (exception == null) {
      return "unknown";
    }
    return exception.getMessagingErrorCode() != null
        ? exception.getMessagingErrorCode().name()
        : String.valueOf(exception.getErrorCode());
  }
}
