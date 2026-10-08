package com.labby.backend.exception;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.Map;

/**
 * Error payload returned by the {@link GlobalExceptionHandler}. {@code fieldErrors} is only
 * populated for validation failures; {@code code} and {@code details} only for domain errors that
 * carry them (rides-v1.yaml) and are omitted otherwise.
 */
public record ErrorResponse(
    Instant timestamp,
    int status,
    String error,
    String message,
    Map<String, String> fieldErrors,
    @JsonInclude(JsonInclude.Include.NON_NULL) String code,
    @JsonInclude(JsonInclude.Include.NON_NULL) Map<String, Object> details) {

  public static ErrorResponse of(int status, String error, String message) {
    return new ErrorResponse(Instant.now(), status, error, message, null, null, null);
  }

  public static ErrorResponse ofValidation(
      int status, String error, String message, Map<String, String> fieldErrors) {
    return new ErrorResponse(Instant.now(), status, error, message, fieldErrors, null, null);
  }

  /**
   * A domain error with its machine code and details.
   *
   * @param status the HTTP status code
   * @param error the reason phrase
   * @param message the human message
   * @param code the machine code, or null
   * @param details extra values, or null
   * @return the payload
   */
  public static ErrorResponse ofCoded(
      int status, String error, String message, String code, Map<String, Object> details) {
    return new ErrorResponse(Instant.now(), status, error, message, null, code, details);
  }
}
