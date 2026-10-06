package com.labby.backend.service;

import com.labby.backend.dto.NotificationPreferenceDto;
import com.labby.backend.dto.NotificationPreferenceUpdateDto;
import com.labby.backend.enums.NotificationCategory;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.model.NotificationPreference;
import com.labby.backend.repository.NotificationPreferenceRepository;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Preferences backed by {@code notification_preferences}; no row = enabled. */
@Service
@Transactional
@RequiredArgsConstructor
public class NotificationPreferenceServiceImpl implements NotificationPreferenceService {

  private final NotificationPreferenceRepository notificationPreferenceRepository;

  @Override
  @Transactional(readOnly = true)
  public List<NotificationPreferenceDto> list(UUID userId) {
    Map<NotificationCategory, Boolean> stored =
        notificationPreferenceRepository.findByUserId(userId).stream()
            .collect(
                Collectors.toMap(
                    NotificationPreference::category, NotificationPreference::isEnabled));
    return Arrays.stream(NotificationCategory.values())
        .map(
            category ->
                new NotificationPreferenceDto(
                    category,
                    !category.isMutable() || stored.getOrDefault(category, true),
                    !category.isMutable()))
        .toList();
  }

  @Override
  public List<NotificationPreferenceDto> update(
      UUID userId, List<NotificationPreferenceUpdateDto> updates) {
    if (updates == null || updates.isEmpty()) {
      throw new InvalidRequestException("At least one preference is required");
    }
    for (NotificationPreferenceUpdateDto update : updates) {
      if (update == null || update.category() == null || update.enabled() == null) {
        throw new InvalidRequestException("Each preference needs a category and enabled");
      }
      if (!update.category().isMutable() && !update.enabled()) {
        throw new InvalidRequestException(
            "The " + update.category().getValue() + " category cannot be disabled");
      }
    }
    for (NotificationPreferenceUpdateDto update : updates) {
      if (!update.category().isMutable()) {
        continue;
      }
      NotificationPreference preference =
          notificationPreferenceRepository
              .findById(NotificationPreference.key(userId, update.category()))
              .orElseGet(
                  () ->
                      NotificationPreference.builder()
                          .userId(userId)
                          .category(update.category().getValue())
                          .build());
      preference.setEnabled(update.enabled());
      notificationPreferenceRepository.save(preference);
    }
    notificationPreferenceRepository.flush();
    return list(userId);
  }
}
