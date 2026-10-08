package com.labby.backend.exception;

import java.util.LinkedHashMap;
import java.util.Map;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * Base class for all domain errors. Carries the {@link HttpStatus} the {@link
 * GlobalExceptionHandler} responds with, and optionally a machine {@code code} plus {@code details}
 * for clients that branch on the error (rides-v1.yaml, e.g. {@code outside_geofence}).
 */
@Getter
public abstract class BusinessException extends RuntimeException {

  private final HttpStatus status;
  private String code;
  private Map<String, Object> details;

  protected BusinessException(HttpStatus status, String message) {
    super(message);
    this.status = status;
  }

  protected BusinessException(HttpStatus status, String message, Throwable cause) {
    super(message, cause);
    this.status = status;
  }

  /**
   * Attaches the contract's machine error code.
   *
   * @param errorCode the code
   * @return this exception
   */
  public BusinessException withCode(String errorCode) {
    this.code = errorCode;
    return this;
  }

  /**
   * Attaches one detail value (rendered under {@code details}).
   *
   * @param key the detail name
   * @param value the value
   * @return this exception
   */
  public BusinessException withDetail(String key, Object value) {
    if (details == null) {
      details = new LinkedHashMap<>();
    }
    details.put(key, value);
    return this;
  }
}
