package com.labby.backend.exception;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** Maps exceptions to JSON {@link ErrorResponse} payloads. */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

  private static final String DRIVER_FILES_PATH = "/api/v1/driver/files";

  /** M14 ticket uploads answer 413 like the driver files (support-v1.yaml). */
  private static final String TICKET_FILES_PATH = "/api/v1/ticket-files";

  /** Domain errors carry their own HTTP status. */
  @ExceptionHandler(BusinessException.class)
  public ResponseEntity<ErrorResponse> handleBusinessException(BusinessException ex) {
    HttpStatus status = ex.getStatus();
    return ResponseEntity.status(status)
        .body(
            ErrorResponse.ofCoded(
                status.value(),
                status.getReasonPhrase(),
                ex.getMessage(),
                ex.getCode(),
                ex.getDetails()));
  }

  /** Domain validation failures carry their own contract-keyed field errors (400). */
  @ExceptionHandler(FieldValidationException.class)
  public ResponseEntity<ErrorResponse> handleFieldValidation(FieldValidationException ex) {
    HttpStatus status = ex.getStatus();
    return ResponseEntity.status(status)
        .body(
            ErrorResponse.ofValidation(
                status.value(), status.getReasonPhrase(), ex.getMessage(), ex.getFieldErrors()));
  }

  /**
   * A concurrent writer won the optimistic lock (e.g. two reviewers deciding the same driver
   * application at once — onboarding-v1.yaml): the loser gets 409, never a 500.
   */
  @ExceptionHandler(OptimisticLockingFailureException.class)
  public ResponseEntity<ErrorResponse> handleOptimisticLock(OptimisticLockingFailureException ex) {
    HttpStatus status = HttpStatus.CONFLICT;
    return ResponseEntity.status(status)
        .body(
            ErrorResponse.of(
                status.value(),
                status.getReasonPhrase(),
                "The resource was changed concurrently; reload and retry"));
  }

  /**
   * A statement hit its PostgreSQL {@code statement_timeout} — the M15 analytics / export time
   * limit (analytics-v1.yaml): 503 {@code query_timeout}, the admin narrows the range or filters.
   */
  @ExceptionHandler(QueryTimeoutException.class)
  public ResponseEntity<ErrorResponse> handleQueryTimeout(QueryTimeoutException ex) {
    log.warn("Statement timed out", ex);
    HttpStatus status = HttpStatus.SERVICE_UNAVAILABLE;
    return ResponseEntity.status(status)
        .body(
            ErrorResponse.ofCoded(
                status.value(),
                status.getReasonPhrase(),
                "The query took too long; narrow the range or the filters",
                "query_timeout",
                null));
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

  /**
   * Oversized multipart uploads map to 400 per the auth contract (photo upload), but to 413 on the
   * driver file upload per the onboarding contract and on the ticket file upload (support-v1).
   */
  @ExceptionHandler(MaxUploadSizeExceededException.class)
  public ResponseEntity<ErrorResponse> handleMaxUploadSize(
      MaxUploadSizeExceededException ex, HttpServletRequest request) {
    HttpStatus status =
        DRIVER_FILES_PATH.equals(request.getRequestURI())
                || TICKET_FILES_PATH.equals(request.getRequestURI())
            ? HttpStatus.PAYLOAD_TOO_LARGE
            : HttpStatus.BAD_REQUEST;
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

  /**
   * Constraint violations on validated controller parameters (e.g. a summary {@code period} other
   * than weekly|monthly, money-v1) are 400 per the contracts, not the catch-all 500 (M8 W5).
   */
  @ExceptionHandler(ConstraintViolationException.class)
  public ResponseEntity<ErrorResponse> handleConstraintViolation(ConstraintViolationException ex) {
    HttpStatus status = HttpStatus.BAD_REQUEST;
    return ResponseEntity.status(status)
        .body(
            ErrorResponse.of(
                status.value(), status.getReasonPhrase(), "Invalid request parameter"));
  }

  /** Missing required query params (e.g. resolve without lat/lng) are 400 per the contracts. */
  @ExceptionHandler(MissingServletRequestParameterException.class)
  public ResponseEntity<ErrorResponse> handleMissingParameter(
      MissingServletRequestParameterException ex) {
    HttpStatus status = HttpStatus.BAD_REQUEST;
    return ResponseEntity.status(status)
        .body(
            ErrorResponse.of(
                status.value(),
                status.getReasonPhrase(),
                "Missing request parameter: " + ex.getParameterName()));
  }

  /**
   * V1 audit I106: an HTTP method the path does not support is 405 (with {@code Allow}), never the
   * catch-all 500.
   */
  @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
  public ResponseEntity<ErrorResponse> handleMethodNotSupported(
      HttpRequestMethodNotSupportedException ex) {
    HttpStatus status = HttpStatus.METHOD_NOT_ALLOWED;
    ResponseEntity.BodyBuilder response = ResponseEntity.status(status);
    if (ex.getSupportedHttpMethods() != null && !ex.getSupportedHttpMethods().isEmpty()) {
      response.allow(ex.getSupportedHttpMethods().toArray(HttpMethod[]::new));
    }
    return response.body(
        ErrorResponse.of(status.value(), status.getReasonPhrase(), "Method not allowed"));
  }

  /** V1 audit I106: an unsupported request Content-Type is 415. */
  @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
  public ResponseEntity<ErrorResponse> handleMediaTypeNotSupported(
      HttpMediaTypeNotSupportedException ex) {
    HttpStatus status = HttpStatus.UNSUPPORTED_MEDIA_TYPE;
    return ResponseEntity.status(status)
        .body(
            ErrorResponse.of(status.value(), status.getReasonPhrase(), "Unsupported content type"));
  }

  /** V1 audit I106: an Accept header no representation satisfies is 406. */
  @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
  public ResponseEntity<ErrorResponse> handleMediaTypeNotAcceptable(
      HttpMediaTypeNotAcceptableException ex) {
    HttpStatus status = HttpStatus.NOT_ACCEPTABLE;
    return ResponseEntity.status(status)
        .body(ErrorResponse.of(status.value(), status.getReasonPhrase(), "Not acceptable"));
  }

  /** V1 audit I106: an unknown path (no handler, no static resource) is 404. */
  @ExceptionHandler({NoResourceFoundException.class, NoHandlerFoundException.class})
  public ResponseEntity<ErrorResponse> handleNoResource(Exception ex) {
    HttpStatus status = HttpStatus.NOT_FOUND;
    return ResponseEntity.status(status)
        .body(ErrorResponse.of(status.value(), status.getReasonPhrase(), "Not found"));
  }

  /** V1 audit I106: a missing required header or multipart part is 400. */
  @ExceptionHandler({MissingRequestHeaderException.class, MissingServletRequestPartException.class})
  public ResponseEntity<ErrorResponse> handleMissingRequestPart(Exception ex) {
    HttpStatus status = HttpStatus.BAD_REQUEST;
    return ResponseEntity.status(status)
        .body(ErrorResponse.of(status.value(), status.getReasonPhrase(), "Missing request part"));
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
