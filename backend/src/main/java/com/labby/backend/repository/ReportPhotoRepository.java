package com.labby.backend.repository;

import com.labby.backend.model.ReportPhoto;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** A report's photos (at most 3, V17). */
public interface ReportPhotoRepository extends JpaRepository<ReportPhoto, ReportPhoto.Key> {

  List<ReportPhoto> findByReportIdOrderByPositionAsc(UUID reportId);

  long countByReportId(UUID reportId);

  boolean existsByStoredFileId(UUID storedFileId);
}
