package com.labby.backend.service;

import com.labby.backend.enums.StoredFileKind;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.model.StoredFile;
import com.labby.backend.model.SupportTicket;
import com.labby.backend.model.TicketAttachment;
import com.labby.backend.repository.StoredFileRepository;
import com.labby.backend.repository.SupportTicketRepository;
import com.labby.backend.repository.TicketAttachmentRepository;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;

/**
 * The file rules tickets and lost-item reports share (SUP-01, LOST-01): which uploads may be
 * attached, and saving a ticket together with them.
 */
@Component
@RequiredArgsConstructor
public class TicketFiles {

  private final SupportTicketRepository supportTicketRepository;
  private final TicketAttachmentRepository ticketAttachmentRepository;
  private final StoredFileRepository storedFileRepository;

  /**
   * Saves a ticket with its attachments; the unique constraints decide the races (a file attached
   * meanwhile → 400).
   */
  public SupportTicket persistWithAttachments(SupportTicket ticket, List<UUID> fileIds) {
    try {
      SupportTicket saved = supportTicketRepository.saveAndFlush(ticket);
      for (int index = 0; index < fileIds.size(); index++) {
        ticketAttachmentRepository.saveAndFlush(
            TicketAttachment.builder()
                .ticketId(saved.getId())
                .position(index + 1)
                .storedFileId(fileIds.get(index))
                .build());
      }
      return saved;
    } catch (DataIntegrityViolationException ex) {
      String cause = String.valueOf(ex.getMostSpecificCause().getMessage());
      if (cause.contains("uq_ticket_attachments_file")) {
        throw new InvalidRequestException("A file is already attached to another ticket");
      }
      throw ex;
    }
  }

  /** The files must be the caller's own unused uploads of the kind, without repeats. */
  public void requireUsableFiles(UUID userId, List<UUID> fileIds, StoredFileKind kind, int max) {
    if (fileIds.size() > max) {
      throw new InvalidRequestException("At most " + max + " files");
    }
    if (new HashSet<>(fileIds).size() != fileIds.size()) {
      throw new InvalidRequestException("A file is listed twice");
    }
    for (UUID fileId : fileIds) {
      boolean own =
          storedFileRepository
              .findByIdAndOwnerUserId(fileId, userId)
              .map(StoredFile::getKind)
              .filter(stored -> stored == kind)
              .isPresent();
      if (!own) {
        throw new InvalidRequestException(
            "Unknown file: upload it with /ticket-files?kind=" + kind.getValue() + " first");
      }
      if (ticketAttachmentRepository.existsByStoredFileId(fileId)) {
        throw new InvalidRequestException("A file is already attached to another ticket");
      }
    }
  }
}
