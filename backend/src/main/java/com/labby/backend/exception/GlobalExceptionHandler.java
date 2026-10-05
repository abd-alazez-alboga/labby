package com.labby.backend.exception;

import java.util.LinkedHashMap;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

/** Maps exceptions to JSON {@link ErrorResponse} payloads. */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

  /** Domain errors carry their own HTTP status. */
  @ExceptionHandler(BusinessException.class)
  public ResponseEntity<ErrorResponse> handleBusinessException(BusinessException ex) {
    HttpStatus status = ex.getStatus();
    return ResponseEntity.status(status)
        .body(ErrorResponse.of(status.value(), status.getReasonPhrase(), ex.getMessage()));
  }

  /** Bean-validation failures become a field-to-message map with HTTP 400. */
  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<ErrorResponse> handleValidationException(
      MethodArgumentNotValidException ex) {
    Map<String, String> fieldErrors = new LinkedHashMap<>();
    for (FieldError fieldError : ex.getBindingResult().getFieldErrors()) {
      fieldErrors.putIfAbsent(fieldError.getField(), fieldError.getDefaultMessage());
    }
    HttpStatus status = HttpStatus.BAD_REQUEST;
    return ResponseEntity.status(status)
        .body(
            ErrorResponse.ofValidation(
                status.value(), status.getReasonPhrase(), "Validation failed", fieldErrors));
  }

  /** Method-security denials (missing permission authority) are 403, never the catch-all 500. */
  @ExceptionHandler(org.springframework.security.access.AccessDeniedException.class)
  public ResponseEntity<ErrorResponse> handleAccessDenied(
      org.springframework.security.access.AccessDeniedException ex) {
    HttpStatus status = HttpStatus.FORBIDDEN;
    return ResponseEntity.status(status)
        .body(ErrorResponse.of(status.value(), status.getReasonPhrase(), "Permission denied"));
  }

  /** Unparseable request bodies (malformed JSON, unknown enum code) are 400 per the contracts. */
  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<ErrorResponse> handleUnreadableBody(HttpMessageNotReadableException ex) {
    HttpStatus status = HttpStatus.BAD_REQUEST;
    return ResponseEntity.status(status)
        .body(ErrorResponse.of(status.value(), status.getReasonPhrase(), "Malformed request body"));
  }

  /** Oversized multipart uploads map to 400 per the auth contract (photo upload). */
  @ExceptionHandler(MaxUploadSizeExceededException.class)
  public ResponseEntity<ErrorResponse> handleMaxUploadSize(MaxUploadSizeExceededException ex) {
    HttpStatus status = HttpStatus.BAD_REQUEST;
    return ResponseEntity.status(status)
        .body(
            ErrorResponse.of(
                status.value(), status.getReasonPhrase(), "Uploaded file is too large"));
  }

  /** Malformed path/query params (e.g. a non-UUID id) are 400 per the contracts, not 500. */
  @ExceptionHandler(MethodArgumentTypeMismatchException.class)
  public ResponseEntity<ErrorResponse> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
    HttpStatus status = HttpStatus.BAD_REQUEST;
    return ResponseEntity.status(status)
        .body(
            ErrorResponse.of(
                status.value(), status.getReasonPhrase(), "Malformed request parameter"));
  }

  /** Catch-all: never leak internals, always log. */
  @ExceptionHandler(Exception.class)
  public ResponseEntity<ErrorResponse> handleUnexpectedException(Exception ex) {
    log.error("Unhandled exception", ex);
    HttpStatus status = HttpStatus.INTERNAL_SERVER_ERROR;
    return ResponseEntity.status(status)
        .body(
            ErrorResponse.of(
                status.value(), status.getReasonPhrase(), "An unexpected error occurred"));
  }
}
