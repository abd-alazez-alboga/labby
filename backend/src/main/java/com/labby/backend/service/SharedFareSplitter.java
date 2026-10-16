package com.labby.backend.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * RIDE-P4 per-seat split (scheduled-shared-v1 "Per-seat split", approved readings 2026-10-16): the
 * stored fare F over the boarded seats B — per-seat P = F ÷ B half-up to 2 decimals, a party's
 * share = P × its size, and the rounding remainder F − Σ shares goes to the creator's share, or to
 * the earliest-joined boarded party when the creator did not ride. Shares always sum to F. Pure.
 */
public final class SharedFareSplitter {

  private SharedFareSplitter() {}

  /**
   * Splits a fare.
   *
   * @param fareTotal the stored fare total
   * @param parties the boarded parties in joined order
   * @return the per-seat amount and each party's share (by member id, joined order)
   */
  public static Split split(BigDecimal fareTotal, List<Party> parties) {
    if (parties.isEmpty()) {
      throw new IllegalArgumentException("A split needs at least one boarded party");
    }
    int seats = parties.stream().mapToInt(Party::partySize).sum();
    BigDecimal perSeat = fareTotal.divide(BigDecimal.valueOf(seats), 2, RoundingMode.HALF_UP);
    Map<UUID, BigDecimal> shares = new LinkedHashMap<>();
    BigDecimal assigned = BigDecimal.ZERO;
    for (Party party : parties) {
      BigDecimal share = perSeat.multiply(BigDecimal.valueOf(party.partySize()));
      shares.put(party.memberId(), share);
      assigned = assigned.add(share);
    }
    BigDecimal remainder = fareTotal.subtract(assigned);
    UUID absorber =
        parties.stream().filter(Party::creator).findFirst().orElse(parties.get(0)).memberId();
    shares.computeIfPresent(absorber, (id, share) -> share.add(remainder));
    return new Split(seats, perSeat, shares);
  }

  /**
   * A boarded party.
   *
   * @param memberId the member row
   * @param partySize its seats
   * @param creator whether it is the creator's party
   */
  public record Party(UUID memberId, int partySize, boolean creator) {}

  /**
   * The split.
   *
   * @param boardedSeats B
   * @param perSeatAmount P (before the remainder)
   * @param shares each party's share, summing to the fare
   */
  public record Split(int boardedSeats, BigDecimal perSeatAmount, Map<UUID, BigDecimal> shares) {}
}
