package com.labby.backend.config;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import com.labby.backend.service.FcmPushSender;
import com.labby.backend.service.LoggingPushSender;
import com.labby.backend.service.PushSender;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Chooses the push sender (ES-03): FCM when Firebase service-account credentials are supplied via
 * {@code FIREBASE_CREDENTIALS_PATH} or {@code FIREBASE_CREDENTIALS_JSON} (env only — never
 * committed), otherwise the log-only sender so dev and tests run without credentials. Credentials
 * that are set but unreadable fail the boot instead of silently dropping pushes.
 */
@Slf4j
@Configuration
public class PushConfig {

  private static final String FIREBASE_APP_NAME = "labby";

  /**
   * The push sender.
   *
   * @param notificationProperties the Firebase credential settings
   * @return FCM when configured, else the log-only sender
   */
  @Bean
  public PushSender pushSender(NotificationProperties notificationProperties) {
    if (!notificationProperties.firebaseConfigured()) {
      log.info("Firebase credentials not configured: pushes are logged, not sent");
      return new LoggingPushSender();
    }
    return new FcmPushSender(FirebaseMessaging.getInstance(firebaseApp(notificationProperties)));
  }

  private static FirebaseApp firebaseApp(NotificationProperties properties) {
    for (FirebaseApp app : FirebaseApp.getApps()) {
      if (app.getName().equals(FIREBASE_APP_NAME)) {
        return app;
      }
    }
    try (InputStream credentials = credentialsStream(properties)) {
      FirebaseOptions options =
          FirebaseOptions.builder()
              .setCredentials(GoogleCredentials.fromStream(credentials))
              .build();
      return FirebaseApp.initializeApp(options, FIREBASE_APP_NAME);
    } catch (IOException ex) {
      throw new UncheckedIOException("Firebase credentials are set but unreadable", ex);
    }
  }

  private static InputStream credentialsStream(NotificationProperties properties)
      throws IOException {
    String json = properties.firebaseCredentialsJson();
    if (json != null && !json.isBlank()) {
      return new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8));
    }
    return Files.newInputStream(Path.of(properties.firebaseCredentialsPath()));
  }
}
