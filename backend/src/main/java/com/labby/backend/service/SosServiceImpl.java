package com.labby.backend.service;

import com.labby.backend.dto.AdminSosEventDto;
import com.labby.backend.dto.AdminSosEventPageDto;
import com.labby.backend.dto.SosEventDto;
import com.labby.backend.dto.SosRequestDto;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.Permission;
import com.labby.backend.enums.RideParty;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Ride;
import com.labby.backend.model.SosEvent;
import com.labby.backend.model.User;
import com.labby.backend.repository.RbacPermissionRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.SosEventRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.util.GeoPoints;
import com.labby.backend.util.PageCursor;
import java.time.Clock;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * SOS (SAFE-01/02). The event row is permanent (V15 trigger — T1); this service records it, clamps
 * the device moment to server time (like ride traces), fans the safety push out to exactly the
 * {@code support:handle} admins, serves the alert list and stamps acknowledgements (audited).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class SosServiceImpl implements SosService {

  static final int MAX_PAGE_SIZE = 50;

  private static final Set<String> STATUSES = Set.of("open", "acknowledged", "all");

  private final SosEventRepository sosEventRepository;
  private final RideRepository rideRepository;
  private final UserRepository userRepository;
  private final RbacPermissionRepository rbacPermissionRepository;
  private final NotificationService notificationService;
  private final AuditService auditService;
  private final Clock clock;

  @Override
  public SosEventDto trigger(UUID userId, UUID rideId, SosRequestDto request) {
    Ride ride =
        rideRepository
            .findById(rideId)
            .orElseThrow(() -> new ResourceNotFoundException("Ride not found"));
    RideParty role = partyOf(ride, userId);
    if (role == null) {
      throw new ForbiddenException("Not a party to this ride");
    }
    if (!ride.isAssigned()) {
      throw (ConflictException)
          new ConflictException("SOS is available during an active accepted ride")
              .withCode("ride_not_active");
    }
    Instant now = clock.instant();
    // The device moment, clamped to server time when ahead (like ride traces).
    Instant triggeredAt = request.recordedAt().isAfter(now) ? now : request.recordedAt();
    SosEvent event =
        sosEventRepository.saveAndFlush(
            SosEvent.builder()
                .rideId(rideId)
                .triggeredByUserId(userId)
                .triggeredByRole(role)
                .location(GeoPoints.point(request.lat(), request.lng()))
                .triggeredAt(triggeredAt)
                .createdAt(now)
                .build());
    // SAFE-01 fan-out: category safety (never mutable) to every support:handle admin, only those.
    Map<String, Object> params = Map.of("rideId", rideId.toString(), "role", role.getValue());
    for (UUID adminId :
        rbacPermissionRepository.findActiveAdminIdsWithPermission(
            Permission.SUPPORT_HANDLE.getValue())) {
      notificationService.queue(adminId, NotificationEvent.SOS_TRIGGERED, params);
    }
    return new SosEventDto(
        event.getId(),
        rideId,
        role,
        event.getLocation().getY(),
        event.getLocation().getX(),
        event.getTriggeredAt(),
        event.getCreatedAt());
  }

  @Override
  @Transactional(readOnly = true)
  public AdminSosEventPageDto adminList(String status, UUID regionId, String before, int size) {
    String statusFilter = status == null || status.isBlank() ? "open" : status;
    if (!STATUSES.contains(statusFilter)) {
      throw new InvalidRequestException("Unknown status: " + statusFilter);
    }
    int pageSize = Math.clamp(size, 1, MAX_PAGE_SIZE);
    Instant beforeAt = null;
    UUID beforeId = null;
    if (before != null && !before.isBlank()) {
      PageCursor cursor = PageCursor.decode(before);
      beforeAt = cursor.createdAt();
      beforeId = cursor.id();
    }
    List<SosEvent> rows =
        sosEventRepository.findAdminPage(
            statusFilter,
            regionId == null ? null : regionId.toString(),
            beforeAt,
            beforeId == null ? UUID.randomUUID() : beforeId,
            pageSize + 1);
    boolean hasNext = rows.size() > pageSize;
    List<SosEvent> page = hasNext ? rows.subList(0, pageSize) : rows;
    String nextCursor =
        hasNext
            ? PageCursor.encode(
                page.get(page.size() - 1).getCreatedAt(), page.get(page.size() - 1).getId())
            : null;
    return new AdminSosEventPageDto(adminViews(page), nextCursor);
  }

  @Override
  public AdminSosEventDto acknowledge(UUID adminUserId, UUID sosEventId, String note) {
    SosEvent event =
        sosEventRepository
            .findById(sosEventId)
            .orElseThrow(() -> new ResourceNotFoundException("SOS event not found"));
    if (event.getAcknowledgedAt() != null) {
      throw (ConflictException)
          new ConflictException("This SOS alert is already acknowledged")
              .withCode("already_acknowledged");
    }
    event.setAcknowledgedBy(adminUserId);
    event.setAcknowledgedAt(clock.instant());
    event.setNote(note == null || note.isBlank() ? null : note);
    sosEventRepository.save(event);
    auditService.record(
        adminUserId,
        "sos.acknowledge",
        "sos_event",
        sosEventId.toString(),
        null,
        Map.of("note", event.getNote() == null ? "" : event.getNote()));
    return adminViews(List.of(event)).get(0);
  }

  /**
   * The admin views of a page of events (UC-A-20): the ride's region and state, the triggering
   * account's contact, and the acknowledgement stamp.
   *
   * @param events the page
   * @return the views, in the page's order
   */
  @Override
  @Transactional(readOnly = true)
  public List<AdminSosEventDto> adminViews(List<SosEvent> events) {
    Map<UUID, Ride> rides =
        rideRepository
            .findAllById(events.stream().map(SosEvent::getRideId).collect(Collectors.toSet()))
            .stream()
            .collect(Collectors.toMap(Ride::getId, Function.identity()));
    Set<UUID> userIds = new HashSet<>();
    for (SosEvent event : events) {
      userIds.add(event.getTriggeredByUserId());
      if (event.getAcknowledgedBy() != null) {
        userIds.add(event.getAcknowledgedBy());
      }
    }
    Map<UUID, User> users =
        userRepository.findAllById(userIds).stream()
            .collect(Collectors.toMap(User::getId, Function.identity()));
    return events.stream().map(event -> adminView(event, rides, users)).toList();
  }

  private static AdminSosEventDto adminView(
      SosEvent event, Map<UUID, Ride> rides, Map<UUID, User> users) {
    Ride ride = rides.get(event.getRideId());
    User triggeredBy = users.get(event.getTriggeredByUserId());
    User acknowledgedBy =
        event.getAcknowledgedBy() == null ? null : users.get(event.getAcknowledgedBy());
    return new AdminSosEventDto(
        event.getId(),
        event.getRideId(),
        event.getTriggeredByRole(),
        event.getLocation().getY(),
        event.getLocation().getX(),
        event.getTriggeredAt(),
        event.getCreatedAt(),
        ride.getRegionId(),
        new AdminSosEventDto.TriggeredByDto(
            triggeredBy.getId(), triggeredBy.getName(), triggeredBy.getPhone()),
        ride.getState().getValue(),
        event.getAcknowledgedAt() == null
            ? null
            : new AdminSosEventDto.AcknowledgedDto(
                event.getAcknowledgedBy(),
                acknowledgedBy == null ? "" : acknowledgedBy.getName(),
                event.getAcknowledgedAt(),
                event.getNote()));
  }

  private static RideParty partyOf(Ride ride, UUID userId) {
    if (userId.equals(ride.getRiderUserId())) {
      return RideParty.RIDER;
    }
    if (userId.equals(ride.getDriverUserId())) {
      return RideParty.DRIVER;
    }
    return null;
  }
}
