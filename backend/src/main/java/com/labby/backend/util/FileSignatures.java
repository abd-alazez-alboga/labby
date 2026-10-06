package com.labby.backend.util;

import java.util.Optional;

/**
 * Detects a driver upload's media type from its leading bytes (magic numbers), never from the
 * client-declared header (onboarding-v1.yaml, NFR-S2): JPEG {@code FF D8 FF}, PNG {@code 89 50 4E
 * 47 0D 0A 1A 0A}, PDF {@code %PDF-}. Anything else is unsupported.
 */
public final class FileSignatures {

  public static final String JPEG = "image/jpeg";
  public static final String PNG = "image/png";
  public static final String PDF = "application/pdf";

  private static final byte[] JPEG_MAGIC = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF};
  private static final byte[] PNG_MAGIC = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
  private static final byte[] PDF_MAGIC = {'%', 'P', 'D', 'F', '-'};

  private FileSignatures() {}

  /**
   * Detects the media type of the content.
   *
   * @param content the file bytes
   * @return {@link #JPEG}, {@link #PNG} or {@link #PDF}; empty when unrecognized
   */
  public static Optional<String> detect(byte[] content) {
    if (startsWith(content, JPEG_MAGIC)) {
      return Optional.of(JPEG);
    }
    if (startsWith(content, PNG_MAGIC)) {
      return Optional.of(PNG);
    }
    if (startsWith(content, PDF_MAGIC)) {
      return Optional.of(PDF);
    }
    return Optional.empty();
  }

  /**
   * The storage-key extension for a detected media type.
   *
   * @param contentType one of the supported media types
   * @return the extension including the dot
   */
  public static String extensionOf(String contentType) {
    return switch (contentType) {
      case JPEG -> ".jpg";
      case PNG -> ".png";
      case PDF -> ".pdf";
      default -> throw new IllegalArgumentException("Unsupported content type: " + contentType);
    };
  }

  private static boolean startsWith(byte[] content, byte[] magic) {
    if (content == null || content.length < magic.length) {
      return false;
    }
    for (int i = 0; i < magic.length; i++) {
      if (content[i] != magic[i]) {
        return false;
      }
    }
    return true;
  }
}
