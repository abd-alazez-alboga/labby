package com.labby.backend.model;

import com.labby.backend.enums.CaseStatus;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.TicketKind;
import com.labby.backend.enums.TicketPriority;
import com.labby.backend.enums.TicketStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A support ticket (SUP-01..03) or a lost-item case (LOST-01/02 — a ticket of kind {@code
 * lost_item} with a {@code caseStatus} its ticket status mirrors; V26). {@code userId} is the
 * account the thread belongs to; {@code openedByUserId} differs only on the SOS-linked tickets an
 * admin opens on the caller's behalf. The V26 checks keep the timestamps and the status coupled:
 * {@code waitingSince} exactly while {@code waiting_on_user}, {@code closedAt} exactly when {@code
 * closed}, {@code resolvedAt} from {@code resolved} on. {@code priority_rank} is a generated column
 * the queue sorts on; it is not mapped. {@code userReadAt} (V27) backs the unread count.
 */
@Entity
@Table(name = "support_tickets")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class SupportTicket {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "support_ticket_id")
  private UUID id;

  @Column(name = "user_id", nullable = false)
  private UUID userId;

  @Builder.Default
  @Column(name = "kind", nullable = false, length = 9)
  private TicketKind kind = TicketKind.TICKET;

  @Column(name = "ticket_category_id", nullable = false)
  private UUID ticketCategoryId;

  @Column(name = "priority", nullable = false, length = 6)
  private TicketPriority priority;

  /** V26 generated column (urgent 0 .. low 3): the queue's sort key; read-only here. */
  @Column(name = "priority_rank", insertable = false, updatable = false)
  private Short priorityRank;

  @Builder.Default
  @Column(name = "status", nullable = false, length = 15)
  private TicketStatus status = TicketStatus.OPEN;

  @Column(name = "case_status", length = 16)
  private CaseStatus caseStatus;

  @Column(name = "description", nullable = false, length = 4000)
  private String description;

  @Column(name = "ride_id")
  private UUID rideId;

  /** V28: the app the ticket was opened from (lost-item cases: rider; SOS: the caller's side). */
  @Column(name = "submitted_as", nullable = false, length = 6)
  private RideParty submittedAs;

  @Column(name = "assignee_user_id")
  private UUID assigneeUserId;

  @Column(name = "opened_by_user_id", nullable = false)
  private UUID openedByUserId;

  @Column(name = "sos_event_id")
  private UUID sosEventId;

  @Column(name = "waiting_since")
  private Instant waitingSince;

  @Column(name = "reminder_sent_at")
  private Instant reminderSentAt;

  @Column(name = "resolved_at")
  private Instant resolvedAt;

  @Column(name = "closed_at")
  private Instant closedAt;

  @Column(name = "user_read_at")
  private Instant userReadAt;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  /**
   * Whether this is a lost-item case.
   *
   * @return true for kind {@code lost_item}
   */
  public boolean isLostItem() {
    return kind == TicketKind.LOST_ITEM;
  }

  /**
   * Whether the thread is read-only (SUP-02: {@code closed} is terminal).
   *
   * @return true when closed
   */
  public boolean isClosed() {
    return status == TicketStatus.CLOSED;
  }

  /**
   * Moves the ticket to a status, keeping the V26-coupled timestamps consistent: entering {@code
   * waiting_on_user} stamps {@code waitingSince} and clears the reminder stamp (a re-entry gets a
   * fresh reminder), leaving it clears both; {@code resolvedAt} is stamped on {@code resolved}
   * (kept through {@code closed}, cleared on a reopen); {@code closedAt} on {@code closed}.
   *
   * @param target the new status
   * @param now the moment
   */
  public void moveTo(TicketStatus target, Instant now) {
    if (target == TicketStatus.WAITING_ON_USER) {
      waitingSince = now;
      reminderSentAt = null;
    } else {
      waitingSince = null;
      reminderSentAt = null;
    }
    if (target == TicketStatus.RESOLVED) {
      resolvedAt = now;
    } else if (target != TicketStatus.CLOSED) {
      resolvedAt = null;
    }
    closedAt = target == TicketStatus.CLOSED ? now : null;
    status = target;
    updatedAt = now;
  }

  @PrePersist
  void onCreate() {
    Instant now = Instant.now();
    if (createdAt == null) {
      createdAt = now;
    }
    if (updatedAt == null) {
      updatedAt = now;
    }
  }

  @PreUpdate
  void onUpdate() {
    if (updatedAt == null) {
      updatedAt = Instant.now();
    }
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof SupportTicket that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
