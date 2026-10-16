package com.labby.backend.repository;

import com.labby.backend.enums.SharedMemberStatus;
import com.labby.backend.model.SharedRideMember;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Shared-ride parties (RIDE-P2..5). Writers lock the RIDE row first. */
public interface SharedRideMemberRepository extends JpaRepository<SharedRideMember, UUID> {

  List<SharedRideMember> findByRideIdOrderByJoinedAtAsc(UUID rideId);

  List<SharedRideMember> findByRideIdAndStatusOrderByJoinedAtAsc(
      UUID rideId, SharedMemberStatus status);

  /** The rider's membership of a ride that still counts (joined, or completed). */
  Optional<SharedRideMember> findFirstByRideIdAndRiderUserIdAndStatusIn(
      UUID rideId, UUID riderUserId, Collection<SharedMemberStatus> statuses);

  /** The rider's latest membership row of a ride, whatever its status. */
  Optional<SharedRideMember> findFirstByRideIdAndRiderUserIdOrderByJoinedAtDesc(
      UUID rideId, UUID riderUserId);

  /**
   * Whether the rider is a joined member of a shared ride still gathering or live (one at a time,
   * scheduled-shared-v1 Shared rides).
   */
  @Query(
      value =
          """
          SELECT EXISTS (SELECT 1 FROM shared_ride_members m JOIN rides r ON r.ride_id = m.ride_id
                         WHERE m.rider_user_id = :riderUserId AND m.status = 'joined'
                           AND r.state IN ('gathering', 'requested', 'offering', 'accepted',
                                           'driver_arrived', 'in_progress'))
          """,
      nativeQuery = true)
  boolean existsOpenMembership(@Param("riderUserId") UUID riderUserId);

  /** The live (dispatched, not ended) shared ride the rider is a joined member of. */
  @Query(
      value =
          """
          SELECT m.ride_id FROM shared_ride_members m JOIN rides r ON r.ride_id = m.ride_id
          WHERE m.rider_user_id = :riderUserId AND m.status = 'joined'
            AND r.state IN ('requested', 'offering', 'accepted', 'driver_arrived', 'in_progress')
          LIMIT 1
          """,
      nativeQuery = true)
  Optional<UUID> findLiveRideOfMember(@Param("riderUserId") UUID riderUserId);

  /** Rides the rider holds a gathering or live joined membership of (suspension clean-up). */
  @Query(
      value =
          """
          SELECT m.ride_id FROM shared_ride_members m JOIN rides r ON r.ride_id = m.ride_id
          WHERE m.rider_user_id = :riderUserId AND m.status = 'joined'
            AND r.state IN ('gathering', 'requested', 'offering')
          """,
      nativeQuery = true)
  List<UUID> findPreAcceptanceRidesOfMember(@Param("riderUserId") UUID riderUserId);
}
