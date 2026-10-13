package com.labby.backend.service;

import com.labby.backend.dto.AdminSosEventDto;
import com.labby.backend.dto.AdminSosEventPageDto;
import com.labby.backend.dto.SosEventDto;
import com.labby.backend.dto.SosRequestDto;
import com.labby.backend.model.SosEvent;
import java.util.List;
import java.util.UUID;

/**
 * SOS (SAFE-01/02, UC-S-16, UC-A-20): the permanent event record with its admin alert fan-out, the
 * admin alert list, and the acknowledge (stand-down) path.
 */
public interface SosService {

  /**
   * Records an SOS event (permanent, append-only) and fans the alert out: an outbox push (category
   * {@code safety}) to every admin holding {@code support:handle} — and only those. Repeat taps
   * create repeat events; escalation is signal, never deduplicated.
   *
   * @param userId the triggering party
   * @param rideId the ride
   * @param request the device position and moment ({@code recordedAt} clamped to server time)
   * @return the recorded event
   */
  SosEventDto trigger(UUID userId, UUID rideId, SosRequestDto request);

  /**
   * One page of the admin alert list, newest first (UC-A-20).
   *
   * @param status {@code open}, {@code acknowledged} or {@code all}
   * @param regionId optional region filter
   * @param before the previous page's cursor, or null
   * @param size page size (clamped to 1..50)
   * @return the page
   */
  AdminSosEventPageDto adminList(String status, UUID regionId, String before, int size);

  /**
   * Acknowledges an open alert (SAFE-01 stand-down; audited). The event's facts stay immutable —
   * only the handling fields are stamped.
   *
   * @param adminUserId the acting admin
   * @param sosEventId the event
   * @param note an optional note (the M14 linked-ticket stub)
   * @return the acknowledged event
   * @throws com.labby.backend.exception.ConflictException {@code already_acknowledged}
   */
  AdminSosEventDto acknowledge(UUID adminUserId, UUID sosEventId, String note);

  /**
   * The admin views of a list of events (the alert list rows and the live ops pins share one
   * shape).
   *
   * @param events the events
   * @return the views, in the given order
   */
  List<AdminSosEventDto> adminViews(List<SosEvent> events);
}
