package com.labby.backend.dto;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * A rider due carried by a completed ride (rides-v1 CarriedDue, M8 audit H3): {@code method} {@code
 * wallet} (taken from the wallet at completion, always {@code collected}) or {@code cash} ({@code
 * earmarked} while the ride's payment is pending, {@code collected} after cash-confirm). The
 * currency always equals the ride's.
 */
public record CarriedDueDto(
    UUID dueId,
    UUID sourceRideId,
    BigDecimal amount,
    String currency,
    String method,
    String status) {

  /** Wire value of a due taken from the rider's wallet. */
  public static final String METHOD_WALLET = "wallet";

  /** Wire value of a due collected in cash through the driver. */
  public static final String METHOD_CASH = "cash";

  /** Wire value of a cash due awaiting the driver's cash-confirm. */
  public static final String STATUS_EARMARKED = "earmarked";

  /** Wire value of a collected due. */
  public static final String STATUS_COLLECTED = "collected";
}
