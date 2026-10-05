package com.labby.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * Thrown when the resource's current state forbids the request (immutable system role, last active
 * Super Admin, role still assigned, …). Maps to 409 per the M3 contract.
 */
public class ConflictException extends BusinessException {

  public ConflictException(String message) {
    super(HttpStatus.CONFLICT, message);
  }
}
