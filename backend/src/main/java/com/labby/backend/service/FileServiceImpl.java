package com.labby.backend.service;

import com.labby.backend.dto.FileContentDto;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.security.FileUrlSigner;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** Verifies expiring file tokens and loads the bytes from storage (NFR-S2). */
@Service
@RequiredArgsConstructor
public class FileServiceImpl implements FileService {

  private static final String NOT_FOUND = "File not found";

  private final FileUrlSigner fileUrlSigner;
  private final StorageProvider storageProvider;

  @Override
  public FileContentDto open(String token) {
    FileUrlSigner.SignedFile signed =
        fileUrlSigner.verify(token).orElseThrow(() -> new ResourceNotFoundException(NOT_FOUND));
    byte[] content;
    try {
      content = storageProvider.load(signed.storageKey());
    } catch (ResourceNotFoundException | IllegalArgumentException ex) {
      throw new ResourceNotFoundException(NOT_FOUND);
    }
    return new FileContentDto(content, signed.contentType());
  }
}
