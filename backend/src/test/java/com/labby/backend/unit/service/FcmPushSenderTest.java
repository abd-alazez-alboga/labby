package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.google.firebase.messaging.BatchResponse;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.MessagingErrorCode;
import com.google.firebase.messaging.MulticastMessage;
import com.google.firebase.messaging.SendResponse;
import com.labby.backend.service.FcmPushSender;
import com.labby.backend.service.PushSender.PushMessage;
import com.labby.backend.service.PushSender.PushResult;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** ES-03: FCM per-token results map to delivered counts and dead tokens to prune. */
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
  @DisplayName("a whole-request FCM failure surfaces as an exception (caller records failed)")
  void shouldThrowOnTransportFailure() throws Exception {
    FirebaseMessaging messaging = mock(FirebaseMessaging.class);
    FirebaseMessagingException exception = mock(FirebaseMessagingException.class);
    when(messaging.sendEachForMulticast(any(MulticastMessage.class))).thenThrow(exception);

    assertThatThrownBy(() -> new FcmPushSender(messaging).send(List.of("a"), MESSAGE))
        .isInstanceOf(IllegalStateException.class);
  }
}
