package com.labby.backend.exception;

import org.springframework.http.HttpStatus;

/** Thrown when creating a resource that already exists. Maps to 409. */
public class ResourceAlreadyExistsException extends BusinessException {

  public ResourceAlreadyExistsException(String resourceType, String field, Object value) {
    super(
        HttpStatus.CONFLICT,
        "%s with %s '%s' already exists".formatted(resourceType, field, value));
  }

  public ResourceAlreadyExistsException(String message) {
    super(HttpStatus.CONFLICT, message);
  }
}
