package com.labby.backend.repository;

import com.labby.backend.enums.ReviewStatus;
import com.labby.backend.model.DriverDocument;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Driver documents (DRV-01, DRV-04). */
public interface DriverDocumentRepository extends JpaRepository<DriverDocument, UUID> {

  List<DriverDocument> findByDriverUserIdAndReviewStatusIn(
      UUID driverUserId, Collection<ReviewStatus> statuses);
}
