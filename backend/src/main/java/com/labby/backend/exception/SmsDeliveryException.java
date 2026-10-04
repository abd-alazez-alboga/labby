package com.labby.backend.exception;

import org.springframework.http.HttpStatus;

/** Thrown when the SMS gateway rejects or fails a send (ES-01). Maps to 502. */
public class SmsDeliveryException extends BusinessException {

  public SmsDeliveryException(String message) {
    super(HttpStatus.BAD_GATEWAY, message);
  }

  public SmsDeliveryException(String message, Throwable cause) {
    super(HttpStatus.BAD_GATEWAY, message, cause);
  }
}
