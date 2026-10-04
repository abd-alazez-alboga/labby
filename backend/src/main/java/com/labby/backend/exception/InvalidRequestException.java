package com.labby.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * Thrown for domain-level bad input: wrong OTP code (attempt counted), wrong current password, or
 * an invalid/expired registration/reset token. Maps to 400.
 */
public class InvalidRequestException extends BusinessException {

  public InvalidRequestException(String message) {
    super(HttpStatus.BAD_REQUEST, message);
  }
}
