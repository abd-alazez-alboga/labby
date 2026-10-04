package com.labby.backend.exception;

import org.springframework.http.HttpStatus;

/** Thrown when an authenticated account lacks a role or permission. Maps to 403. */
public class ForbiddenException extends BusinessException {

  public ForbiddenException(String message) {
    super(HttpStatus.FORBIDDEN, message);
  }
}
