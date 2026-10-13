package com.labby.backend.util;

import com.labby.backend.exception.InvalidRequestException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.UUID;

/**
 * The opaque keyset page cursor of the M10 lists: the last row's (created_at in microseconds, id),
 * base64url-encoded. Same shape as the notification center's cursor.
 *
 * @param createdAt the row's created_at, microsecond precision
 * @param id the row's id (tie-break)
 */
public record PageCursor(Instant createdAt, UUID id) {

  /**
   * Encodes a row position.
   *
   * @param createdAt the row's created_at
   * @param id the row's id
   * @return the opaque cursor
   */
  public static String encode(Instant createdAt, UUID id) {
    long micros =
        ChronoUnit.MICROS.between(Instant.EPOCH, createdAt.truncatedTo(ChronoUnit.MICROS));
    String raw = micros + "_" + id;
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /**
   * Decodes a client-supplied cursor.
   *
   * @param cursor the opaque cursor
   * @return the position
   * @throws InvalidRequestException when malformed
   */
  public static PageCursor decode(String cursor) {
    try {
      String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      int separator = raw.indexOf('_');
      long micros = Long.parseLong(raw.substring(0, separator));
      return new PageCursor(
          Instant.EPOCH.plus(micros, ChronoUnit.MICROS),
          UUID.fromString(raw.substring(separator + 1)));
    } catch (IllegalArgumentException | IndexOutOfBoundsException ex) {
      throw new InvalidRequestException("Malformed cursor");
    }
  }
}
