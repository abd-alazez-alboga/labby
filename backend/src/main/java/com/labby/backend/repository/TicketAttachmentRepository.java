package com.labby.backend.repository;

import com.labby.backend.model.TicketAttachment;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** A ticket's attachments / a case's photos, in upload order (V26). */
public interface TicketAttachmentRepository
    extends JpaRepository<TicketAttachment, TicketAttachment.Key> {

  List<TicketAttachment> findByTicketIdOrderByPositionAsc(UUID ticketId);

  List<TicketAttachment> findByTicketIdInOrderByTicketIdAscPositionAsc(Collection<UUID> ticketIds);

  boolean existsByStoredFileId(UUID storedFileId);
}
