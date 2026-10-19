package com.labby.backend.repository;

import com.labby.backend.model.TicketCategory;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Ticket categories (SUP-01/03, UC-A-24; V26). */
public interface TicketCategoryRepository extends JpaRepository<TicketCategory, UUID> {

  List<TicketCategory> findAllByOrderBySortOrderAscNameEnAsc();

  /** The user-pickable list: active, never the system row (ruling 3). */
  List<TicketCategory> findByActiveTrueAndSystemCodeIsNullOrderBySortOrderAscNameEnAsc();
}
