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
  /**
   * To the rider(s) when the expected arrival — at the pickup, or at the destination through the
   * remaining stops — slips by 5+ minutes over the last one they were told, at most once per 5
   * minutes (V1 audit W40, owner ruling 2026-10-20; UC-R-06 step 3). Params: rideId, etaMinutes,
   * phase ({@code pickup} | {@code destination}).
   */
  RIDE_ETA_DELAYED("ride.eta_delayed"),
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
  SOS_TRIGGERED("sos.triggered"),
  // M11 trust events (trust-v1.yaml; category account).
  /**
   * To the user whose rider or driver role was suspended for a low rating (USR-05) or by an admin
   * (USR-06). Params: role (rider|driver), reason (low_rating|manual), note (manual), minAvgRating
   * and minRatedRides (low_rating — the rule that fired).
   */
  ROLE_SUSPENDED("account.role_suspended"),
  /** To the user whose role an admin reactivated (USR-06). Params: role, note. */
  ROLE_REACTIVATED("account.role_reactivated"),
  /** To the user whose whole account an admin suspended (USR-06 "deactivate"). Params: note. */
  ACCOUNT_SUSPENDED("account.suspended"),
  /** To the user whose whole account an admin reactivated. Params: note. */
  ACCOUNT_REACTIVATED("account.reactivated"),
  /**
   * To the reporter when their report is resolved — the outcome only, never the internal notes
   * (REP-02). Params: outcome (substantiated|unsubstantiated), role (the reporter's side).
   */
  REPORT_RESOLVED("report.resolved"),
  /**
   * To the driver when a DRV-07 warning is raised (never a suspension). Params: metric
   * (acceptance|cancellation), valuePercent, thresholdPercent, windowDays.
   */
  DRIVER_METRIC_WARNING("driver.metric_warning"),
  // M12 scheduled-ride events (scheduled-shared-v1.yaml; category scheduled unless noted).
  /** To the rider when a driver claims. Params: rideId, driverName, pickupDate, pickupTime. */
  SCHEDULED_CLAIMED("scheduled.claimed"),
  /**
   * To the driver when their claim went back to the board at conversion: their current active
   * vehicle no longer serves the ride (review W3). Params: rideId, pickupDate, pickupTime.
   */
  SCHEDULED_CLAIM_LOST("scheduled.claim_lost"),
  /**
   * To the rider when the claiming driver gives it back. Params: rideId, pickupDate, pickupTime.
   */
  SCHEDULED_RELEASED("scheduled.released"),
  /** RIDE-S3 reminder. Params: rideId, as (rider|driver), minutesBefore, pickupDate, pickupTime. */
  SCHEDULED_REMINDER("scheduled.reminder"),
  /** To both parties when the claimed ride turned live at T − lead. Params: rideId, as. */
  SCHEDULED_CONVERTED("scheduled.converted"),
  /**
   * Category ride: to both parties when the rider was on another live ride at the conversion /
   * fallback moment (ruling 2026-10-16). Params: rideId, as.
   */
  SCHEDULED_CANCELLED_RIDER_BUSY("scheduled.cancelled_rider_busy"),
  // M12 shared-ride events (scheduled-shared-v1.yaml; category ride — never muted).
  /** To every joined member when the group is dispatched (P2). Params: rideId, trigger. */
  SHARED_DISPATCHED("shared.dispatched"),
  /**
   * To the members of a cancelled group (P3). Params: rideId, reason
   * (creator_cancelled|expired|account_suspended).
   */
  SHARED_CANCELLED("shared.cancelled"),
  /** To the member the driver marked absent (UC-D-13 E1). Params: rideId, fee?, currency?. */
  SHARED_MEMBER_NO_SHOW("shared.member_no_show"),
  // M13 growth events (growth-v1.yaml; rendered under the PROMOTIONS category, mutable).
  /** To the user who earned a badge (GAME-01). Params: badgeCode. */
  BADGE_AWARDED("growth.badge_awarded"),
  /** To a participant whose challenge goal is reached (GAME-02). Params: challengeId, points. */
  CHALLENGE_COMPLETED("growth.challenge_completed"),
  /**
   * To both sides when a referral pays out on the referee's first completed ride (GRW-03). Params:
   * as (referrer|referee), amount, currency.
   */
  REFERRAL_REWARDED("growth.referral_rewarded"),
  // M15 incentives (incentives-v1.yaml; category account, audience driver, screen incentives).
  /**
   * To the driver an incentive paid (DRV-08). Params: kind (weekly_trips|peak_hours|rating),
   * amount, currency, weekStart, trips, avgRating?.
   */
  INCENTIVE_AWARDED("incentive.awarded"),
  // M14 support events (support-v1.yaml; category account, audience all — both apps hold support).
  /** To the ticket's user on creation (UC-S-19). Params: ticketId, kind (ticket|lost_item). */
  SUPPORT_TICKET_CREATED("support.ticket_created"),
  /** To the user on every ticket status change (SUP-02). Params: ticketId, status. */
  SUPPORT_TICKET_STATUS_CHANGED("support.ticket_status_changed"),
  /** To the user on a support reply in the thread. Params: ticketId. */
  SUPPORT_TICKET_MESSAGE("support.ticket_message"),
  /** To the user once per waiting_on_user stay after 48 h (owner ruling). Params: ticketId. */
  SUPPORT_WAITING_REMINDER("support.waiting_reminder"),
  /**
   * To the driver when a rider opens a lost-item case on their ride (UC-D-21). Params: ticketId.
   */
  LOST_ITEM_CASE_OPENED("lost_item.case_opened"),
  /**
   * To both parties on every case-status change (LOST-02). Params: ticketId, caseStatus, as
   * (rider|driver — the recipient's side, which picks the audience).
   */
  LOST_ITEM_CASE_STATUS_CHANGED("lost_item.case_status_changed");

  private final String value;

  NotificationEvent(String value) {
    this.value = value;
  }

  @JsonValue
  public String getValue() {
    return value;
  }
}
