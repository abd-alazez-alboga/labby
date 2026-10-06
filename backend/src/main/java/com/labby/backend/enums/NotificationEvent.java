package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Template keys queued behind the notification seam (onboarding-v1.yaml "Notifications"). M6
 * delivers them to the notification center + push; the keys are shared with that renderer.
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
  DRIVER_REINSTATED("driver.reinstated");

  private final String value;

  NotificationEvent(String value) {
    this.value = value;
  }

  @JsonValue
  public String getValue() {
    return value;
  }
}
