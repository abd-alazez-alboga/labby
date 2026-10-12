package com.labby.backend.repository;

import com.labby.backend.enums.OfferResponse;
import com.labby.backend.model.RideOffer;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** The dispatch trail (RIDE-03). Offers are only written while their ride row is locked. */
public interface RideOfferRepository extends JpaRepository<RideOffer, UUID> {

  Optional<RideOffer> findFirstByRideIdAndResponseIsNull(UUID rideId);

  Optional<RideOffer> findFirstByDriverUserIdAndResponseIsNull(UUID driverUserId);

  List<RideOffer> findByRideIdOrderBySequenceAsc(UUID rideId);

  long countByRideId(UUID rideId);

  /** The accepted offer of a ride (its pickup distance feeds the M8 pickup fee, PRC-03). */
  Optional<RideOffer> findFirstByRideIdAndResponseOrderBySequenceDesc(
      UUID rideId, OfferResponse response);

  /**
   * The ride of one of the driver's offers, read without loading the offer entity — the caller
   * locks the ride first and only then loads the offer, so it sees the offer's latest state.
   */
  @Query(
      "SELECT o.rideId FROM RideOffer o WHERE o.id = :offerId AND o.driverUserId = :driverUserId")
  Optional<UUID> findRideIdOfDriverOffer(
      @Param("offerId") UUID offerId, @Param("driverUserId") UUID driverUserId);
}
