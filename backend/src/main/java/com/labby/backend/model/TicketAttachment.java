package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * One ticket attachment (SUP-01) or lost-item photo (LOST-01) in upload order (positions 1..5,
 * V26); a stored file is attached once.
 */
@Entity
@Table(name = "ticket_attachments")
@IdClass(TicketAttachment.Key.class)
@Getter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class TicketAttachment {

  @Id
  @Column(name = "support_ticket_id")
  private UUID ticketId;

  @Id
  @Column(name = "position")
  private int position;

  @Column(name = "stored_file_id", nullable = false)
  private UUID storedFileId;

  /** The composite primary key (ticket x position). */
  @Getter
  @NoArgsConstructor
  @AllArgsConstructor
  public static class Key implements Serializable {

    private static final long serialVersionUID = 1L;

    private UUID ticketId;
    private int position;

    @Override
    public boolean equals(Object other) {
      if (this == other) {
        return true;
      }
      if (!(other instanceof Key that)) {
        return false;
      }
      return Objects.equals(ticketId, that.ticketId) && position == that.position;
    }

    @Override
    public int hashCode() {
      return Objects.hash(ticketId, position);
    }
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof TicketAttachment that)) {
      return false;
    }
    return ticketId != null && ticketId.equals(that.ticketId) && position == that.position;
  }

  @Override
  public int hashCode() {
    return Objects.hash(ticketId, position);
  }
}
