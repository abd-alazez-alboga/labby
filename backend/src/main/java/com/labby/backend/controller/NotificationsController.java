package com.labby.backend.controller;

import com.labby.backend.dto.NotificationPageDto;
import com.labby.backend.dto.NotificationPreferenceDto;
import com.labby.backend.dto.NotificationPreferenceUpdateDto;
import com.labby.backend.dto.UnreadCountDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.NotificationCenterService;
import com.labby.backend.service.NotificationPreferenceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The notification center (UC-S-11) and push preferences (UC-S-12) per realtime-v1.yaml. Any
 * authenticated account; each caller only ever sees and changes their own notifications.
 */
@RestController
@RequestMapping("/api/v1/notifications")
@Tag(name = "Notifications", description = "Notification center and push preferences")
@RequiredArgsConstructor
public class NotificationsController {

  private final NotificationCenterService notificationCenterService;
  private final NotificationPreferenceService notificationPreferenceService;

  /**
   * One page of the calling client's center, newest first.
   *
   * @param app the calling client (rider, driver, admin)
   * @param category optional category filter
   * @param before optional cursor from the previous page
   * @param size page size (1..50)
   * @return 200 with the page
   */
  @GetMapping
  @Operation(summary = "Notification center, newest first (UC-S-11)")
  public ResponseEntity<NotificationPageDto> list(
      @RequestParam String app,
      @RequestParam(required = false) String category,
      @RequestParam(required = false) String before,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        notificationCenterService.list(SecurityUtils.currentUserId(), app, category, before, size));
  }

  /**
   * Unread count for the badge.
   *
   * @param app the calling client
   * @return 200 with the count
   */
  @GetMapping("/unread-count")
  @Operation(summary = "Unread count for the badge")
  public ResponseEntity<UnreadCountDto> unreadCount(@RequestParam String app) {
    return ResponseEntity.ok(
        notificationCenterService.unreadCount(SecurityUtils.currentUserId(), app));
  }

  /**
   * Marks one notification read (idempotent).
   *
   * @param notificationId the notification
   * @return 204; 404 when unknown or not the caller's
   */
  @PostMapping("/{notificationId}/read")
  @Operation(summary = "Mark one notification read (idempotent)")
  public ResponseEntity<Void> markRead(@PathVariable UUID notificationId) {
    notificationCenterService.markRead(SecurityUtils.currentUserId(), notificationId);
    return ResponseEntity.noContent().build();
  }

  /**
   * Marks every notification of the calling client's center read.
   *
   * @param app the calling client
   * @return 204
   */
  @PostMapping("/read-all")
  @Operation(summary = "Mark every notification of this client's center read")
  public ResponseEntity<Void> markAllRead(@RequestParam String app) {
    notificationCenterService.markAllRead(SecurityUtils.currentUserId(), app);
    return ResponseEntity.noContent().build();
  }

  /**
   * All six categories with their push state.
   *
   * @return 200 with the preferences
   */
  @GetMapping("/preferences")
  @Operation(summary = "Per-category push preferences (UC-S-12)")
  public ResponseEntity<List<NotificationPreferenceDto>> preferences() {
    return ResponseEntity.ok(notificationPreferenceService.list(SecurityUtils.currentUserId()));
  }

  /**
   * Partial preference update.
   *
   * @param updates the categories to change
   * @return 200 with the full, updated list; 400 when disabling ride or safety
   */
  @PutMapping("/preferences")
  @Operation(summary = "Update preferences (partial — only the listed categories change)")
  public ResponseEntity<List<NotificationPreferenceDto>> updatePreferences(
      @RequestBody List<NotificationPreferenceUpdateDto> updates) {
    return ResponseEntity.ok(
        notificationPreferenceService.update(SecurityUtils.currentUserId(), updates));
  }
}
