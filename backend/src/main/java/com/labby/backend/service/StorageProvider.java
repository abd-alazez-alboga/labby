package com.labby.backend.service;

import com.labby.backend.dto.FileAccessUrlDto;

/**
 * Private binary storage seam (NFR-S2). Files are never publicly reachable: they are served only
 * through authenticated endpoints or through expiring URLs that authenticated, permission-checked
 * endpoints mint with {@link #accessUrl}. A future object-store provider returns its own presigned
 * URLs from the same method; callers never build file URLs themselves.
 */
public interface StorageProvider {

  /**
   * Stores content under a key, replacing any previous content.
   *
   * @param key the relative storage key (e.g. {@code photos/<uuid>.jpg})
   * @param content the bytes
   * @return the stored key
   */
  String store(String key, byte[] content);

  /**
   * Loads content by key.
   *
   * @param key the relative storage key
   * @return the bytes
   * @throws com.labby.backend.exception.ResourceNotFoundException when the key does not exist
   */
  byte[] load(String key);

  /**
   * Mints an expiring URL to a stored file. The CALLER is responsible for having checked that the
   * current user may see the file — this method grants access to whoever holds the URL until it
   * expires ({@code STORAGE_URL_TTL_SECONDS}).
   *
   * @param key the relative storage key
   * @param contentType the media type the file is served with
   * @return the URL and its expiry
   */
  FileAccessUrlDto accessUrl(String key, String contentType);
}
