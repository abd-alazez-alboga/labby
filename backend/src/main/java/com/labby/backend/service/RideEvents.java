package com.labby.backend.service;

import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.SharedMemberStatus;
import com.labby.backend.model.Ride;
import com.labby.backend.model.RideOffer;
import com.labby.backend.model.SharedRideMember;
import com.labby.backend.repository.SharedRideMemberRepository;
import com.labby.backend.service.RideAssembler.Audience;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * The rides-v1.yaml event catalog. Socket frames go through the {@link RealtimePublisher} (after
 * commit, every instance); pushes go through the notification outbox (category {@code ride}). Every
 * ride frame names the party it is for in {@code as} ({@code rider} | {@code driver}) — one account
 * may hold both roles, with both apps connected.
 */
@Component
@RequiredArgsConstructor
public class RideEvents {

  private final RealtimePublisher realtimePublisher;
  private final RideAssembler rideAssembler;
  private final NotificationService notificationService;
  private final SharedRideMemberRepository sharedRideMemberRepository;

  /**
   * {@code ride.state} to the rider and, when one is bound, the driver (RIDE-02: every transition).
   *
   * @param ride the ride after the transition
   */
  public void stateChanged(Ride ride) {
    rideFrame("ride.state", ride, null);
  }

  /**
   * {@code ride.updated} (not a state change) to both parties.
   *
   * @param ride the ride
   * @param reason {@code route_changed} | {@code payment_confirmed} | {@code payment_unpaid}
   */
  public void updated(Ride ride, String reason) {
    rideFrame("ride.updated", ride, reason);
  }

  /**
   * {@code offer.new} to the offered driver, plus its push.
   *
   * @param ride the ride
   * @param offer the opened offer
   */
  public void offerOpened(Ride ride, RideOffer offer) {
    Map<String, Object> frame = new LinkedHashMap<>();
    frame.put("type", "offer.new");
    frame.put("as", "driver");
    frame.put("offer", rideAssembler.offer(ride, offer));
    realtimePublisher.publish(List.of(offer.getDriverUserId()), frame);
    notificationService.queue(
        offer.getDriverUserId(),
        NotificationEvent.RIDE_OFFER,
        Map.of("offerId", offer.getId().toString()));
  }

  /**
   * {@code offer.withdrawn} to the offer's driver.
   *
   * @param offer the closed offer
   * @param reason {@code timeout} | {@code ride_ended}
   */
  public void offerWithdrawn(RideOffer offer, String reason) {
    Map<String, Object> frame = new LinkedHashMap<>();
    frame.put("type", "offer.withdrawn");
    frame.put("as", "driver");
    frame.put("offerId", offer.getId().toString());
    frame.put("rideId", offer.getRideId().toString());
    frame.put("reason", reason);
    realtimePublisher.publish(List.of(offer.getDriverUserId()), frame);
  }

  /**
   * {@code ride.driver_position} to the rider (TRK-02).
   *
   * @param ride the assigned ride
   * @param lat latitude
   * @param lng longitude
   * @param headingDeg heading, or null
   * @param recordedAt device fix time
   */
  public void driverPosition(
      Ride ride, double lat, double lng, Double headingDeg, Instant recordedAt) {
    Map<String, Object> frame = new LinkedHashMap<>();
    frame.put("type", "ride.driver_position");
    frame.put("as", "rider");
    frame.put("rideId", ride.getId().toString());
    frame.put("lat", lat);
    frame.put("lng", lng);
    if (headingDeg != null) {
      frame.put("headingDeg", headingDeg);
    }
    frame.put("recordedAt", recordedAt.toString());
    if (ride.getEtaSeconds() != null) {
      frame.put("etaSeconds", ride.getEtaSeconds());
    }
    realtimePublisher.publish(riderSide(ride), frame);
  }

  /**
   * {@code ride.connection} to both parties (TRK-04).
   *
   * @param ride the assigned ride
   * @param lost true when the driver's stream went stale, false when it resumed
   */
  public void connection(Ride ride, boolean lost) {
    for (String side : List.of("rider", "driver")) {
      Map<String, Object> frame = new LinkedHashMap<>();
      frame.put("type", "ride.connection");
      frame.put("as", side);
      frame.put("rideId", ride.getId().toString());
      frame.put("driverStream", lost ? "lost" : "ok");
      realtimePublisher.publish(
          "rider".equals(side) ? riderSide(ride) : List.of(ride.getDriverUserId()), frame);
    }
  }

  /**
   * {@code shared.occupancy} to every joined member of a gathering shared ride (scheduled-shared-v1
   * Notifications) — socket only, no push.
   *
   * @param ride the shared ride
   * @param seatsTaken seats taken now
   * @param totalSeats seats offered
   */
  public void sharedOccupancy(Ride ride, int seatsTaken, int totalSeats) {
    Map<String, Object> frame = new LinkedHashMap<>();
    frame.put("type", "shared.occupancy");
    frame.put("as", "rider");
    frame.put("rideId", ride.getId().toString());
    frame.put("seatsTaken", seatsTaken);
    frame.put("totalSeats", totalSeats);
    realtimePublisher.publish(riderSide(ride), frame);
  }

  /**
   * Queues a ride push to the ride's rider side: the rider, or — on a shared ride — every party
   * still riding along (M12, each member is "the ride's rider").
   *
   * @param ride the ride
   * @param event the template
   * @param params the template params
   */
  public void pushRiders(Ride ride, NotificationEvent event, Map<String, Object> params) {
    for (UUID rider : riderSide(ride)) {
      notificationService.queue(rider, event, params);
    }
  }

  /**
   * The rider-side recipients of a ride: its rider, or the joined / completed members of a shared
   * ride.
   *
   * @param ride the ride
   * @return the user ids
   */
  public List<UUID> riderSide(Ride ride) {
    if (ride.getKind() != RideKind.SHARED) {
      return List.of(ride.getRiderUserId());
    }
    List<UUID> members =
        sharedRideMemberRepository.findByRideIdOrderByJoinedAtAsc(ride.getId()).stream()
            .filter(
                member ->
                    member.getStatus() == SharedMemberStatus.JOINED
                        || member.getStatus() == SharedMemberStatus.COMPLETED)
            .map(SharedRideMember::getRiderUserId)
            .distinct()
            .toList();
    return members.isEmpty() ? List.of(ride.getRiderUserId()) : members;
  }

  /**
   * Queues a ride push (category {@code ride}).
   *
   * @param userId the recipient
   * @param event the template
   * @param params the template params
   */
  public void push(UUID userId, NotificationEvent event, Map<String, Object> params) {
    notificationService.queue(userId, event, params);
  }

  private void rideFrame(String type, Ride ride, String reason) {
    for (UUID rider : riderSide(ride)) {
      publishRide(type, ride, Audience.RIDER, rider, reason);
    }
    if (ride.getDriverUserId() != null) {
      publishRide(type, ride, Audience.DRIVER, ride.getDriverUserId(), reason);
    }
  }

  private void publishRide(
      String type, Ride ride, Audience audience, UUID recipient, String reason) {
    Map<String, Object> frame = new LinkedHashMap<>();
    frame.put("type", type);
    frame.put("as", audience == Audience.RIDER ? "rider" : "driver");
    if (reason != null) {
      frame.put("reason", reason);
    }
    frame.put("ride", rideAssembler.view(ride, audience, recipient));
    realtimePublisher.publish(List.of(recipient), frame);
  }
}
