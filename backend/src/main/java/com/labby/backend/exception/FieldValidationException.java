package com.labby.backend.exception;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * Domain validation failure with per-field messages, keyed per the contract (e.g. {@code
 * documents[insurance].expiresOn}, {@code vehicle.photoFileIds}, {@code profilePhoto} —
 * onboarding-v1.yaml). Maps to 400 with {@code fieldErrors}.
 */
@Getter
public class FieldValidationException extends BusinessException {

  private final transient Map<String, String> fieldErrors;

  public FieldValidationException(Map<String, String> fieldErrors) {
    super(HttpStatus.BAD_REQUEST, "Validation failed");
    this.fieldErrors = Collections.unmodifiableMap(new LinkedHashMap<>(fieldErrors));
  }
}
