package com.labby.backend.repository;

import com.labby.backend.model.HelpCategory;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

/** Help-center categories (SUP-04, V26). */
public interface HelpCategoryRepository extends JpaRepository<HelpCategory, UUID> {

  List<HelpCategory> findAllByOrderBySortOrderAscNameEnAsc();

  @Query("SELECT COALESCE(MAX(c.sortOrder), -1) FROM HelpCategory c")
  int maxSortOrder();
}
