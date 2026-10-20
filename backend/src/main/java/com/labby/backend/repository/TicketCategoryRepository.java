package com.labby.backend.repository;

import com.labby.backend.model.TicketCategory;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Ticket categories (SUP-01/03, UC-A-24; V26). */
public interface TicketCategoryRepository extends JpaRepository<TicketCategory, UUID> {

  List<TicketCategory> findAllByOrderBySortOrderAscNameEnAsc();

  /**
   * The user-pickable list: active, never a system-opened row (ruling 3) — admin-made categories
   * plus the user-pickable system ones (review V1 W39).
   *
   * @param pickableCodes the system codes users may pick
   * @return the categories, by sort order then English name
   */
  @Query(
      """
      SELECT c FROM TicketCategory c
      WHERE c.active = true AND (c.systemCode IS NULL OR c.systemCode IN :pickableCodes)
      ORDER BY c.sortOrder ASC, c.nameEn ASC
      """)
  List<TicketCategory> findUserPickable(@Param("pickableCodes") Collection<String> pickableCodes);
}
