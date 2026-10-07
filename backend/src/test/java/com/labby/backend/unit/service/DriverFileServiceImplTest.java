package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.labby.backend.config.StorageProperties;
import com.labby.backend.dto.UploadedFileDto;
import com.labby.backend.enums.StoredFileKind;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.PayloadTooLargeException;
import com.labby.backend.exception.TooManyRequestsException;
import com.labby.backend.model.StoredFile;
import com.labby.backend.repository.StoredFileRepository;
import com.labby.backend.service.DriverFileServiceImpl;
import com.labby.backend.service.StorageProvider;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;

/**
 * Driver upload rules: daily cap (429), size cap (413), content-detected type, PDF documents only,
 * server key.
 */
@ExtendWith(MockitoExtension.class)
class DriverFileServiceImplTest {

  private static final UUID USER = UUID.randomUUID();
  private static final Instant NOW = Instant.parse("2026-10-07T10:00:00Z");
  private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 1};
  private static final byte[] PDF = {'%', 'P', 'D', 'F', '-', '1'};

  @Mock private StoredFileRepository storedFileRepository;
  @Mock private StorageProvider storageProvider;

  private DriverFileServiceImpl service;

  @BeforeEach
  void setUp() {
    service =
        new DriverFileServiceImpl(
            storedFileRepository,
            storageProvider,
            new StorageProperties("/tmp/unused", 1024, 16, 300, 3, 7),
            Clock.fixed(NOW, ZoneOffset.UTC));
  }

  @Test
  @DisplayName(
      "the STORAGE_DRIVER_FILE_DAILY_CAP-th upload in a rolling 24 h is the last one (429)")
  void shouldEnforceTheRollingDailyCap() {
    when(storedFileRepository.countByOwnerUserIdAndCreatedAtAfter(
            USER, NOW.minus(Duration.ofDays(1))))
        .thenReturn(3L);
    MockMultipartFile png = new MockMultipartFile("file", "x.png", "image/png", PNG);
    assertThatThrownBy(() -> service.upload(USER, "vehicle_photo", png))
        .isInstanceOf(TooManyRequestsException.class);
    verify(storageProvider, never()).store(anyString(), any());
  }

  @Test
  @DisplayName("a file above STORAGE_DRIVER_FILE_MAX_BYTES is 413 and never stored")
  void shouldRejectOversizedFile() {
    MockMultipartFile big = new MockMultipartFile("file", "x.pdf", "application/pdf", new byte[17]);
    assertThatThrownBy(() -> service.upload(USER, "document", big))
        .isInstanceOf(PayloadTooLargeException.class);
    verify(storageProvider, never()).store(anyString(), any());
  }

  @Test
  @DisplayName("the client's Content-Type is ignored: a PNG declared as PDF is stored as PNG")
  void shouldTypeByContent() {
    when(storageProvider.store(anyString(), any())).thenAnswer(call -> call.getArgument(0));
    when(storedFileRepository.save(any()))
        .thenAnswer(
            call -> {
              StoredFile file = call.getArgument(0);
              file.setId(UUID.randomUUID());
              return file;
            });

    UploadedFileDto stored =
        service.upload(
            USER, "vehicle_photo", new MockMultipartFile("file", "a.pdf", "application/pdf", PNG));

    assertThat(stored.contentType()).isEqualTo("image/png");
    assertThat(stored.kind()).isEqualTo(StoredFileKind.VEHICLE_PHOTO);
    verify(storageProvider)
        .store(argThat(key -> key.matches("driver-files/[0-9a-f-]{36}\\.png")), eq(PNG));
    verify(storedFileRepository).save(argThat(file -> USER.equals(file.getOwnerUserId())));
  }

  @Test
  @DisplayName("PDF as a vehicle photo, unknown bytes, empty files and unknown kinds are 400")
  void shouldRejectInvalidUploads() {
    assertThatThrownBy(
            () ->
                service.upload(
                    USER, "vehicle_photo", new MockMultipartFile("file", "a", "image/png", PDF)))
        .isInstanceOf(InvalidRequestException.class);
    assertThatThrownBy(
            () ->
                service.upload(
                    USER, "document", new MockMultipartFile("file", "a", "image/png", new byte[4])))
        .isInstanceOf(InvalidRequestException.class);
    assertThatThrownBy(
            () ->
                service.upload(
                    USER, "document", new MockMultipartFile("file", "a", "image/png", new byte[0])))
        .isInstanceOf(InvalidRequestException.class);
    assertThatThrownBy(
            () -> service.upload(USER, "selfie", new MockMultipartFile("file", "a", null, PNG)))
        .isInstanceOf(InvalidRequestException.class);
    verify(storageProvider, never()).store(anyString(), any());
  }
}
