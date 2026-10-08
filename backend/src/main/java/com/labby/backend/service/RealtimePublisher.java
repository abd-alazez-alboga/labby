package com.labby.backend.service;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/**
 * Server → client realtime frames (rides-v1.yaml events) to accounts, wherever their sockets are
 * connected. Called inside the business transaction: the frame is sent only if it commits.
 */
public interface RealtimePublisher {

  /**
   * Publishes a frame to the accounts' sockets on every instance, after commit.
   *
   * @param userIds the recipients
   * @param frame the JSON frame ({@code type} + fields)
   */
  void publish(Collection<UUID> userIds, Map<String, Object> frame);
}
