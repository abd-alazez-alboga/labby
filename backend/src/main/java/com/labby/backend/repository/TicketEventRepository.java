package com.labby.backend.repository;

import com.labby.backend.model.TicketEvent;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Ticket history rows (SUP-02, V26). */
public interface TicketEventRepository extends JpaRepository<TicketEvent, UUID> {

  List<TicketEvent> findByTicketIdOrderByCreatedAtAscSeqAsc(UUID ticketId);
}
