package com.labby.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * Thrown when an OTP is expired, consumed, missing, or its attempts are exhausted — the client must
 * request a new code or restart the flow (AUTH-04). Maps to 410.
 */
public class GoneException extends BusinessException {

  public GoneException(String message) {
    super(HttpStatus.GONE, message);
  }
}
