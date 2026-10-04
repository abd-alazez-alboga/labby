package com.labby.backend.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * Base class for all domain errors. Carries the {@link HttpStatus} the {@link
 * GlobalExceptionHandler} responds with.
 */
@Getter
public abstract class BusinessException extends RuntimeException {

  private final HttpStatus status;

  protected BusinessException(HttpStatus status, String message) {
    super(message);
    this.status = status;
  }

  protected BusinessException(HttpStatus status, String message, Throwable cause) {
    super(message, cause);
    this.status = status;
  }
}
