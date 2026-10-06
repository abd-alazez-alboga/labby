package com.labby.backend.exception;

import org.springframework.http.HttpStatus;

/** Thrown when an upload exceeds its configured maximum size. Maps to 413 (onboarding-v1.yaml). */
public class PayloadTooLargeException extends BusinessException {

  public PayloadTooLargeException(String message) {
    super(HttpStatus.PAYLOAD_TOO_LARGE, message);
  }
}
