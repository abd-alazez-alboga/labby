package com.labby.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * Thrown when a rate limit is hit: OTP resend cooldown, hourly OTP cap, or login throttling
 * (AUTH-04, NFR-S3). Maps to 429.
 */
public class TooManyRequestsException extends BusinessException {

  public TooManyRequestsException(String message) {
    super(HttpStatus.TOO_MANY_REQUESTS, message);
  }
}
