package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Template keys queued behind the notification seam (onboarding-v1.yaml "Notifications", and the M7
 * ride events of rides-v1.yaml). M6 delivers them to the notification center + push; the keys are
 * shared with that renderer.
 */
public enum NotificationEvent {
  DRIVER_APPLICATION_SUBMITTED("driver_application.submitted"),
  DRIVER_APPLICATION_UNDER_REVIEW("driver_application.under_review"),
  DRIVER_APPLICATION_NEEDS_CHANGES("driver_application.needs_changes"),
  DRIVER_APPLICATION_APPROVED("driver_application.approved"),
  DRIVER_APPLICATION_REJECTED("driver_application.rejected"),
  VEHICLE_SWITCH_SUBMITTED("vehicle_switch.submitted"),
  VEHICLE_SWITCH_APPROVED("vehicle_switch.approved"),
  VEHICLE_SWITCH_REJECTED("vehicle_switch.rejected"),
  DOCUMENT_RENEWAL_SUBMITTED("document_renewal.submitted"),
  DOCUMENT_RENEWAL_APPROVED("document_renewal.approved"),
  DOCUMENT_RENEWAL_REJECTED("document_renewal.rejected"),
  /** Params: documentType, expiresOn, daysLeft (30 or 7). */
  DOCUMENT_EXPIRY_REMINDER("document.expiry_reminder"),
  /** Params: reason. */
  DRIVER_SUSPENDED("driver.suspended"),
  DRIVER_REINSTATED("driver.reinstated"),
  // M7 ride events (rides-v1.yaml push catalog; category ride — never muted).
  /** To the offered driver. Params: offerId. */
  RIDE_OFFER("ride.offer"),
  /** To the rider. Params: rideId, driverName. */
  RIDE_ACCEPTED("ride.accepted"),
  /** To the rider. Params: rideId, driverName. */
  RIDE_DRIVER_ARRIVED("ride.driver_arrived"),
  /** To the rider. Params: rideId. */
  RIDE_STARTED("ride.started"),
  /** To the rider. Params: rideId, total, currency. */
  RIDE_COMPLETED("ride.completed"),
  /**
   * To the rider. Params: rideId (the re-dispatched ride, or the cancelled one on a no-show),
   * noShow, fee, currency.
   */
  RIDE_CANCELLED_BY_DRIVER("ride.cancelled_by_driver"),
  /** To the released driver. Params: rideId. */
  RIDE_CANCELLED_BY_RIDER("ride.cancelled_by_rider"),
  /** To the rider. Params: rideId. */
  RIDE_NO_DRIVER_FOUND("ride.no_driver_found"),
  // M8 money events (money-v1.yaml; PRC-03, PAY-03, COM-03).
  /** To the rider when wait-charge accrual starts (PRC-03). Params: rideId, rate, currency. */
  RIDE_WAIT_CHARGE_STARTED("ride.wait_charge_started"),
  /** To the credited user (UC-A-15). Params: amount, currency. */
  WALLET_GRANTED("wallet.granted"),
  /** To the refunded user (PAY-03). Params: amount, currency. */
  WALLET_REFUNDED("wallet.refunded"),
  /** To the driver entering the floor-warning margin (COM-03). Params: balance, floor, currency. */
  DRIVER_BALANCE_WARNING("driver.balance_warning"),
  /** To the driver at/below the floor (COM-03). Params: balance, floor, currency. */
  DRIVER_BALANCE_BLOCKED("driver.balance_blocked"),
  /**
   * To the driver a settlement lifted back above the floor (UC-A-27). Params: balance, currency.
   */
  DRIVER_BALANCE_UNBLOCKED("driver.balance_unblocked"),
  // M10 comms events (comms-v1.yaml).
  /**
   * To the chat recipient on every new message, live socket or not (CHAT-02). Params: rideId,
   * senderName, recipientRole (rider|driver), rideActive ("true" while the ride is active — the
   * push then bypasses a muted chat category, NTF-02's ride-critical exception).
   */
  CHAT_MESSAGE("chat.message"),
  /**
   * To every admin holding {@code support:handle} when an SOS fires (SAFE-01; category safety —
   * never muted). Params: rideId, role (rider|driver).
   */
  SOS_TRIGGERED("sos.triggered");

  private final String value;

  NotificationEvent(String value) {
    this.value = value;
  }

  @JsonValue
  public String getValue() {
    return value;
  }
}
