package com.labby.backend.service;

import com.google.firebase.messaging.AndroidConfig;
import com.google.firebase.messaging.AndroidNotification;
import com.google.firebase.messaging.BatchResponse;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.MessagingErrorCode;
import com.google.firebase.messaging.MulticastMessage;
import com.google.firebase.messaging.Notification;
import com.google.firebase.messaging.SendResponse;
import com.google.firebase.messaging.WebpushConfig;
import com.google.firebase.messaging.WebpushFcmOptions;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;

/**
 * FCM push via the Firebase Admin SDK (ES-03). One multicast per notification; per-token failures
 * that mean the token is dead (unregistered, invalid, wrong sender) are reported back so the
 * dispatcher prunes them. On Android every push targets the clients' notification channel {@link
 * #ANDROID_CHANNEL_ID} (HIGH importance, so it shows as a heads-up banner). Message text is never
 * logged.
 */
@Slf4j
public class FcmPushSender implements PushSender {

  /**
   * The Android notification channel both apps create (realtime-v1.yaml "Push payload"); without it
   * a push lands in the OS fallback channel.
   */
  public static final String ANDROID_CHANNEL_ID = "default";

  /** FCM's multicast limit. */
  static final int MAX_TOKENS_PER_CALL = 500;

  /**
   * V1 audit W6: admin deep-link screens → their path in the admin dashboard. A push linking one
   * gets a web-push click link (same origin as the dashboard), so a background tap on the SOS alert
   * opens live ops.
   */
  static final Map<String, String> ADMIN_WEB_PATHS =
      Map.of(NotificationRenderer.SCREEN_LIVE_OPS, "/live-ops");

  private final FirebaseMessaging firebaseMessaging;

  /** The admin dashboard's https origin, or null (no web-push click links). */
  private final String adminWebOrigin;

  /**
   * A sender without web-push click links.
   *
   * @param firebaseMessaging the Firebase client
   */
  public FcmPushSender(FirebaseMessaging firebaseMessaging) {
    this(firebaseMessaging, null);
  }

  /**
   * A sender whose admin pushes link into the dashboard at {@code adminWebOrigin}. FCM accepts
   * HTTPS links only, so any other origin (local http dev) disables the links.
   *
   * @param firebaseMessaging the Firebase client
   * @param adminWebOrigin the dashboard origin (e.g. {@code https://admin.example.com}), or null
   */
  public FcmPushSender(FirebaseMessaging firebaseMessaging, String adminWebOrigin) {
    this.firebaseMessaging = firebaseMessaging;
    this.adminWebOrigin =
        adminWebOrigin != null && adminWebOrigin.startsWith("https://")
            ? adminWebOrigin.replaceAll("/+$", "")
            : null;
  }

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
    MulticastMessage.Builder builder = MulticastMessage.builder();
    String link = webLink(message);
    if (link != null) {
      builder.setWebpushConfig(
          WebpushConfig.builder().setFcmOptions(WebpushFcmOptions.withLink(link)).build());
    }
    MulticastMessage multicast =
        builder
            .setNotification(
                Notification.builder().setTitle(message.title()).setBody(message.body()).build())
            .setAndroidConfig(
                AndroidConfig.builder()
                    .setNotification(
                        AndroidNotification.builder().setChannelId(ANDROID_CHANNEL_ID).build())
                    .build())
            .putAllData(message.data())
            .addAllTokens(chunk)
            .build();
    try {
      return firebaseMessaging.sendEachForMulticast(multicast);
    } catch (FirebaseMessagingException ex) {
      throw new IllegalStateException("FCM send failed: " + errorCode(ex), ex);
    }
  }

  /** The dashboard URL a web-push tap opens (V1 audit W6), or null. */
  String webLink(PushMessage message) {
    String screen = message.data().get("screen");
    String path = screen == null ? null : ADMIN_WEB_PATHS.get(screen);
    return adminWebOrigin == null || path == null ? null : adminWebOrigin + path;
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
