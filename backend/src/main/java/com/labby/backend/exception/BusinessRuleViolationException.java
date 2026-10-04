package com.labby.backend.exception;

import org.springframework.http.HttpStatus;

/** Thrown when a request is well-formed but violates a business rule. Maps to 422. */
public class BusinessRuleViolationException extends BusinessException {

  public BusinessRuleViolationException(String message) {
    super(HttpStatus.UNPROCESSABLE_ENTITY, message);
  }
}
