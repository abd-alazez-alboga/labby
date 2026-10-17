package com.labby.backend.service;

import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.SharedMemberStatus;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Ride;
import com.labby.backend.model.SharedRideMember;
import com.labby.backend.repository.SharedRideMemberRepository;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Who is a party to a ride (scheduled-shared-v1 "Shared rides in the other contracts"): the driver,
 * and on the rider side the ride's rider — or, on a shared ride, a member in one of the statuses
 * the caller's feature allows. The driver addresses one member of a shared ride by {@code memberId}
 * (chat, ratings, reports — required there, ignored on one-rider rides).
 */
@Component
@RequiredArgsConstructor
public class RideParties {

  /** Members who rode / are riding along. */
  public static final List<SharedMemberStatus> RIDING =
      List.of(SharedMemberStatus.JOINED, SharedMemberStatus.COMPLETED);

  /** Members who rode to the end. */
  public static final List<SharedMemberStatus> COMPLETED = List.of(SharedMemberStatus.COMPLETED);

  /** Members who were with the ride after dispatch (everyone but a pre-dispatch leaver). */
  public static final List<SharedMemberStatus> DISPATCHED =
      List.of(
          SharedMemberStatus.JOINED,
          SharedMemberStatus.COMPLETED,
          SharedMemberStatus.CANCELLED,
          SharedMemberStatus.NO_SHOW);

  private final SharedRideMemberRepository sharedRideMemberRepository;

  /**
   * The caller's side of a ride.
   *
   * @param ride the ride
   * @param userId the caller
   * @param memberStatuses on a shared ride, the member statuses that count as the rider side
   * @return the side, or null when the caller is no party
   */
  public RideParty sideOf(Ride ride, UUID userId, Collection<SharedMemberStatus> memberStatuses) {
    if (userId.equals(ride.getDriverUserId())) {
      return RideParty.DRIVER;
    }
    if (ride.getKind() != RideKind.SHARED) {
      return userId.equals(ride.getRiderUserId()) ? RideParty.RIDER : null;
    }
    return member(ride, userId, memberStatuses).isPresent() ? RideParty.RIDER : null;
  }

  /**
   * The caller's membership of a shared ride in one of the statuses (latest first).
   *
   * @param ride the ride
   * @param userId the caller
   * @param statuses the statuses that count
   * @return the member, empty on a one-rider ride or when none matches
   */
  public Optional<SharedRideMember> member(
      Ride ride, UUID userId, Collection<SharedMemberStatus> statuses) {
    if (ride.getKind() != RideKind.SHARED) {
      return Optional.empty();
    }
    return sharedRideMemberRepository
        .findFirstByRideIdAndRiderUserIdOrderByJoinedAtDesc(ride.getId(), userId)
        .filter(member -> statuses.contains(member.getStatus()));
  }

  /**
   * The member the DRIVER addresses on a shared ride: {@code memberId} is required there (400
   * {@code member_required}); an unknown member, or one in another status, is a 404.
   *
   * @param ride a shared ride
   * @param memberId the addressed member
   * @param statuses the statuses that count
   * @return the member
   */
  public SharedRideMember driverTarget(
      Ride ride, UUID memberId, Collection<SharedMemberStatus> statuses) {
    if (memberId == null) {
      throw (InvalidRequestException)
          new InvalidRequestException("memberId is required on a shared ride")
              .withCode("member_required");
    }
    return sharedRideMemberRepository
        .findById(memberId)
        .filter(member -> member.getRideId().equals(ride.getId()))
        .filter(member -> statuses.contains(member.getStatus()))
        .orElseThrow(() -> new ResourceNotFoundException("Member not found"));
  }

  /**
   * The rider the caller deals with: for the driver the addressed member's rider on a shared ride
   * (else the ride's rider); for a rider-side caller the driver.
   *
   * @param ride the ride
   * @param side the caller's side
   * @param memberId the driver's addressed member (shared rides)
   * @param statuses the member statuses the driver may address
   * @return the counterpart's user id
   */
  public UUID counterpart(
      Ride ride, RideParty side, UUID memberId, Collection<SharedMemberStatus> statuses) {
    if (side == RideParty.RIDER) {
      return ride.getDriverUserId();
    }
    return ride.getKind() == RideKind.SHARED
        ? driverTarget(ride, memberId, statuses).getRiderUserId()
        : ride.getRiderUserId();
  }
}
