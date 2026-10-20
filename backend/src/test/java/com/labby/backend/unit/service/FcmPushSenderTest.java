package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.api.client.json.gson.GsonFactory;
import com.google.firebase.messaging.BatchResponse;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.Message;
import com.google.firebase.messaging.MessagingErrorCode;
import com.google.firebase.messaging.MulticastMessage;
import com.google.firebase.messaging.SendResponse;
import com.labby.backend.service.FcmPushSender;
import com.labby.backend.service.PushSender.PushMessage;
import com.labby.backend.service.PushSender.PushResult;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * ES-03: FCM per-token results map to delivered counts and dead tokens to prune; every push targets
 * the apps' Android notification channel.
 */
class FcmPushSenderTest {

  private static final PushMessage MESSAGE =
      new PushMessage("T", "B", Map.of("event", "driver.reinstated"));

  private static SendResponse success() {
    SendResponse response = mock(SendResponse.class);
    when(response.isSuccessful()).thenReturn(true);
    return response;
  }

  private static SendResponse failure(MessagingErrorCode code) {
    FirebaseMessagingException exception = mock(FirebaseMessagingException.class);
    when(exception.getMessagingErrorCode()).thenReturn(code);
    SendResponse response = mock(SendResponse.class);
    when(response.isSuccessful()).thenReturn(false);
    when(response.getException()).thenReturn(exception);
    return response;
  }

  @Test
  @DisplayName("unregistered / invalid tokens are reported dead; transient errors are not")
  void shouldReportDeadTokens() throws Exception {
    FirebaseMessaging messaging = mock(FirebaseMessaging.class);
    BatchResponse batch = mock(BatchResponse.class);
    List<SendResponse> responses =
        List.of(
            success(),
            failure(MessagingErrorCode.UNREGISTERED),
            failure(MessagingErrorCode.INVALID_ARGUMENT),
            failure(MessagingErrorCode.UNAVAILABLE));
    when(batch.getResponses()).thenReturn(responses);
    when(messaging.sendEachForMulticast(any(MulticastMessage.class))).thenReturn(batch);

    PushResult result = new FcmPushSender(messaging).send(List.of("a", "b", "c", "d"), MESSAGE);

    assertThat(result.delivered()).isEqualTo(1);
    assertThat(result.invalidTokens()).containsExactlyInAnyOrder("b", "c");
  }

  @Test
  @DisplayName("every push targets the apps' Android notification channel \"default\"")
  @SuppressWarnings("unchecked")
  void shouldTargetTheDefaultAndroidChannel() throws Exception {
    FirebaseMessaging messaging = mock(FirebaseMessaging.class);
    BatchResponse batch = mock(BatchResponse.class);
    List<SendResponse> responses = List.of(success(), success());
    when(batch.getResponses()).thenReturn(responses);
    ArgumentCaptor<MulticastMessage> sent = ArgumentCaptor.forClass(MulticastMessage.class);
    when(messaging.sendEachForMulticast(sent.capture())).thenReturn(batch);

    new FcmPushSender(messaging).send(List.of("a", "b"), MESSAGE);

    // The per-token messages exactly as the SDK serializes them onto the wire.
    Method messageList = MulticastMessage.class.getDeclaredMethod("getMessageList");
    messageList.setAccessible(true);
    List<Message> messages = (List<Message>) messageList.invoke(sent.getValue());
    assertThat(messages).hasSize(2);
    for (Message message : messages) {
      JsonNode wire =
          new ObjectMapper().readTree(GsonFactory.getDefaultInstance().toString(message));
      assertThat(wire.at("/android/notification/channel_id").asText())
          .isEqualTo(FcmPushSender.ANDROID_CHANNEL_ID)
          .isEqualTo("default");
      assertThat(wire.at("/notification/title").asText()).isEqualTo("T");
      assertThat(wire.at("/data/event").asText()).isEqualTo("driver.reinstated");
    }
  }

  @Test
  @DisplayName("a whole-request FCM failure surfaces as an exception (caller records failed)")
  void shouldThrowOnTransportFailure() throws Exception {
    FirebaseMessaging messaging = mock(FirebaseMessaging.class);
    FirebaseMessagingException exception = mock(FirebaseMessagingException.class);
    when(messaging.sendEachForMulticast(any(MulticastMessage.class))).thenThrow(exception);

    assertThatThrownBy(() -> new FcmPushSender(messaging).send(List.of("a"), MESSAGE))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  @DisplayName("V1 audit W6: a live-ops push carries the dashboard's https live-ops click link")
  @SuppressWarnings("unchecked")
  void shouldLinkTheSosPushToLiveOps() throws Exception {
    FirebaseMessaging messaging = mock(FirebaseMessaging.class);
    BatchResponse batch = mock(BatchResponse.class);
    List<SendResponse> responses = List.of(success());
    when(batch.getResponses()).thenReturn(responses);
    ArgumentCaptor<MulticastMessage> sent = ArgumentCaptor.forClass(MulticastMessage.class);
    when(messaging.sendEachForMulticast(sent.capture())).thenReturn(batch);
    PushMessage sos =
        new PushMessage(
            "SOS alert",
            "B",
            Map.of("event", "sos.triggered", "screen", "live_ops", "params", "{}"));

    new FcmPushSender(messaging, "https://admin.labby.example/").send(List.of("a"), sos);

    Method messageList = MulticastMessage.class.getDeclaredMethod("getMessageList");
    messageList.setAccessible(true);
    Message message = ((List<Message>) messageList.invoke(sent.getValue())).get(0);
    JsonNode wire = new ObjectMapper().readTree(GsonFactory.getDefaultInstance().toString(message));
    assertThat(wire.at("/webpush/fcm_options/link").asText())
        .isEqualTo("https://admin.labby.example/live-ops");
    // No https origin (local dev) or a non-admin screen: no link.
    assertThat(webLinkOf(new FcmPushSender(messaging, "http://localhost:5173"), sos)).isNull();
    assertThat(webLinkOf(new FcmPushSender(messaging, "https://a.example"), MESSAGE)).isNull();
  }

  private static String webLinkOf(FcmPushSender sender, PushMessage message) throws Exception {
    Method webLink = FcmPushSender.class.getDeclaredMethod("webLink", PushMessage.class);
    webLink.setAccessible(true);
    return (String) webLink.invoke(sender, message);
  }
}
