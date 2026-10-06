package com.labby.backend.service;

import com.labby.backend.dto.NotificationPreferenceDto;
import com.labby.backend.dto.NotificationPreferenceUpdateDto;
import java.util.List;
import java.util.UUID;

/**
 * Per-category push preferences (NTF-02, UC-S-12). Muting stops PUSH only — the center still
 * records (UC-S-25 A1); ride and safety are locked on.
 */
public interface NotificationPreferenceService {

  /**
   * All six categories with their state.
   *
   * @param userId the caller
   * @return the preferences, in category order
   */
  List<NotificationPreferenceDto> list(UUID userId);

  /**
   * Partial update: only the listed categories change.
   *
   * @param userId the caller
   * @param updates the changes (at least one)
   * @return the full, updated list
   * @throws com.labby.backend.exception.InvalidRequestException when empty, incomplete, or
   *     disabling a locked category
   */
  List<NotificationPreferenceDto> update(
      UUID userId, List<NotificationPreferenceUpdateDto> updates);
}
