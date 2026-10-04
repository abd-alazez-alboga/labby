package com.labby.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * Thrown when authentication fails (bad credentials, deleted account, invalid or revoked token).
 * Maps to 401; the message never reveals whether the account exists (NFR-S3).
 */
public class UnauthorizedException extends BusinessException {

  public UnauthorizedException(String message) {
    super(HttpStatus.UNAUTHORIZED, message);
  }
}
