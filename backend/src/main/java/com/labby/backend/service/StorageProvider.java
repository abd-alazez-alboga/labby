package com.labby.backend.service;

/**
 * Private binary storage seam (NFR-S2). Files are never publicly reachable; they are served only
 * through authenticated, permission-checked endpoints.
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
}
