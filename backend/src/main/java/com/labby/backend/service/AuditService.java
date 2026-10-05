package com.labby.backend.service;

import com.labby.backend.dto.AuditLogPageDto;
import java.time.OffsetDateTime;
import java.util.UUID;

/** Append-only audit trail of admin actions (RBAC-05, UC-A-04). */
public interface AuditService {

  /**
   * Writes one audit entry. Entries are INSERT-only — the V4 trigger makes mutation impossible.
   *
   * @param actorUserId the acting admin
   * @param action the action key, e.g. {@code role.update}
   * @param targetType the target kind, e.g. {@code role}
   * @param targetId the target identifier
   * @param before the state before the mutation (serialized to JSON), or null
   * @param after the state after the mutation (serialized to JSON), or null
   */
  void record(
      UUID actorUserId,
      String action,
      String targetType,
      String targetId,
      Object before,
      Object after);

  /**
   * Returns a filtered, newest-first page (UC-A-04). All filters optional and combinable.
   *
   * @param actorId filter by acting admin
   * @param action exact action key
   * @param targetType target kind
   * @param targetId target identifier
   * @param from inclusive lower bound on the entry timestamp
   * @param to inclusive upper bound on the entry timestamp
   * @param page zero-based page index
   * @param size page size
   * @return the page
   */
  AuditLogPageDto query(
      UUID actorId,
      String action,
      String targetType,
      String targetId,
      OffsetDateTime from,
      OffsetDateTime to,
      int page,
      int size);
}
