package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Notification delivery (M6, NTF-01..03, ES-03).
 *
 * @param dispatchCron cron of the outbox dispatcher (render → center row → push); {@code -}
 *     disables the trigger (tests drive the dispatcher directly)
 * @param firebaseCredentialsPath path to the Firebase service-account JSON file (env only, never
 *     committed); blank = not configured
 * @param firebaseCredentialsJson the Firebase service-account JSON inline (env only, an alternative
 *     to the path); blank = not configured. When neither is set, pushes are logged, never sent.
 */
@ConfigurationProperties(prefix = "labby.notifications")
public record NotificationProperties(
    String dispatchCron, String firebaseCredentialsPath, String firebaseCredentialsJson) {

  /**
   * Whether FCM credentials were supplied.
   *
   * @return true when a credentials path or inline JSON is set
   */
  public boolean firebaseConfigured() {
    return hasText(firebaseCredentialsPath) || hasText(firebaseCredentialsJson);
  }

  private static boolean hasText(String value) {
    return value != null && !value.isBlank();
  }
}
