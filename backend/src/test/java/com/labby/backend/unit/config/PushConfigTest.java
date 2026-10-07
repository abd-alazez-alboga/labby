package com.labby.backend.unit.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.firebase.FirebaseApp;
import com.labby.backend.config.NotificationProperties;
import com.labby.backend.config.PushConfig;
import com.labby.backend.service.FcmPushSender;
import com.labby.backend.service.LoggingPushSender;
import com.labby.backend.service.PushSender;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Regression for the FCM runtime-classpath fix (review M6 W6): building the push sender from
 * service-account credentials initialises the Firebase app, its JSON factory and HTTP transport —
 * offline, no network — so this fails if {@code google-http-client-jackson2} or {@code httpclient5}
 * drop out of the classpath. The key is generated per test run; nothing real is used.
 */
class PushConfigTest {

  private static final String FIREBASE_APP_NAME = "labby";

  @AfterEach
  void deleteFirebaseApp() {
    FirebaseApp.getApps().stream()
        .filter(app -> app.getName().equals(FIREBASE_APP_NAME))
        .forEach(FirebaseApp::delete);
  }

  private static String fakeServiceAccountJson() throws Exception {
    KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
    generator.initialize(2048);
    String key =
        Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.US_ASCII))
            .encodeToString(generator.generateKeyPair().getPrivate().getEncoded());
    Map<String, String> account = new LinkedHashMap<>();
    account.put("type", "service_account");
    account.put("project_id", "labby-test");
    account.put("private_key_id", "test-key-id");
    account.put(
        "private_key", "-----BEGIN PRIVATE KEY-----\n" + key + "\n-----END PRIVATE KEY-----\n");
    account.put("client_email", "push@labby-test.iam.gserviceaccount.com");
    account.put("client_id", "100000000000000000000");
    account.put("token_uri", "https://oauth2.googleapis.com/token");
    return new ObjectMapper().writeValueAsString(account);
  }

  @Test
  @DisplayName("service-account credentials build the FCM sender (runtime classpath intact)")
  void shouldBuildFcmSenderFromServiceAccountJson() throws Exception {
    PushSender sender =
        new PushConfig()
            .pushSender(new NotificationProperties("-", null, fakeServiceAccountJson()));

    assertThat(sender).isInstanceOf(FcmPushSender.class);
  }

  @Test
  @DisplayName("no credentials: the log-only sender")
  void shouldFallBackToLoggingSenderWithoutCredentials() {
    assertThat(new PushConfig().pushSender(new NotificationProperties("-", null, null)))
        .isInstanceOf(LoggingPushSender.class);
  }
}
