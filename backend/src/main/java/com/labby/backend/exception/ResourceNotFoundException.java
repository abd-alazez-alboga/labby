package com.labby.backend.exception;

import org.springframework.http.HttpStatus;

/** Thrown when a requested resource does not exist. Maps to 404. */
public class ResourceNotFoundException extends BusinessException {

  public ResourceNotFoundException(String resourceType, Object id) {
    super(HttpStatus.NOT_FOUND, "%s with id '%s' was not found".formatted(resourceType, id));
  }

  public ResourceNotFoundException(String message) {
    super(HttpStatus.NOT_FOUND, message);
  }
}
