package com.labby.backend.service;

import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.model.NotificationOutboxEntry;
import com.labby.backend.repository.NotificationOutboxRepository;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Outbox-backed notification seam: rows in {@code notification_outbox} await M6 delivery. */
@Service
@Transactional
@RequiredArgsConstructor
public class NotificationServiceImpl implements NotificationService {

  private final NotificationOutboxRepository notificationOutboxRepository;

  @Override
  public void queue(UUID userId, NotificationEvent event, Map<String, Object> params) {
    notificationOutboxRepository.save(
        NotificationOutboxEntry.builder()
            .userId(userId)
            .event(event.getValue())
            .params(new HashMap<>(params))
            .build());
  }
}
