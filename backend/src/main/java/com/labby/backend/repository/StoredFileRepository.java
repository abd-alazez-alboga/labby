package com.labby.backend.repository;

import com.labby.backend.model.StoredFile;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Private uploads (NFR-S2). */
public interface StoredFileRepository extends JpaRepository<StoredFile, UUID> {

  /** Ownership-checked lookup: an applicant may only reference their own uploads. */
  Optional<StoredFile> findByIdAndOwnerUserId(UUID id, UUID ownerUserId);
}
