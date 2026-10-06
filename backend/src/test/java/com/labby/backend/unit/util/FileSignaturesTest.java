package com.labby.backend.unit.util;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.labby.backend.util.FileSignatures;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Magic-byte detection of driver uploads (onboarding-v1.yaml, NFR-S2). */
class FileSignaturesTest {

  @Test
  @DisplayName("JPEG, PNG and PDF are recognized by their leading bytes")
  void shouldDetectSupportedTypes() {
    assertThat(FileSignatures.detect(new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 0x01}))
        .contains("image/jpeg");
    assertThat(
            FileSignatures.detect(
                new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00}))
        .contains("image/png");
    assertThat(FileSignatures.detect("%PDF-1.4 rest".getBytes(StandardCharsets.US_ASCII)))
        .contains("application/pdf");
  }

  @Test
  @DisplayName("anything else — other formats, truncated or empty content — is unsupported")
  void shouldRejectUnknownContent() {
    assertThat(FileSignatures.detect("GIF89a".getBytes(StandardCharsets.US_ASCII))).isEmpty();
    assertThat(FileSignatures.detect("<html>%PDF-".getBytes(StandardCharsets.US_ASCII))).isEmpty();
    assertThat(FileSignatures.detect(new byte[] {(byte) 0xFF, (byte) 0xD8})).isEmpty();
    assertThat(FileSignatures.detect(new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A}))
        .isEmpty();
    assertThat(FileSignatures.detect("%PDF".getBytes(StandardCharsets.US_ASCII))).isEmpty();
    assertThat(FileSignatures.detect(new byte[0])).isEmpty();
    assertThat(FileSignatures.detect(null)).isEmpty();
  }

  @Test
  @DisplayName("storage-key extensions follow the detected type")
  void shouldMapExtensions() {
    assertThat(FileSignatures.extensionOf(FileSignatures.JPEG)).isEqualTo(".jpg");
    assertThat(FileSignatures.extensionOf(FileSignatures.PNG)).isEqualTo(".png");
    assertThat(FileSignatures.extensionOf(FileSignatures.PDF)).isEqualTo(".pdf");
    assertThatThrownBy(() -> FileSignatures.extensionOf("image/gif"))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
