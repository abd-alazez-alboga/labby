package com.labby.backend.exception;

import java.time.Instant;
import java.util.Map;

/**
 * Error payload returned by the {@link GlobalExceptionHandler}. {@code fieldErrors} is only
 * populated for validation failures.
 */
public record ErrorResponse(
    Instant timestamp, int status, String error, String message, Map<String, String> fieldErrors) {

  public static ErrorResponse of(int status, String error, String message) {
    return new ErrorResponse(Instant.now(), status, error, message, null);
  }

  public static ErrorResponse ofValidation(
      int status, String error, String message, Map<String, String> fieldErrors) {
    return new ErrorResponse(Instant.now(), status, error, message, fieldErrors);
  }
}
