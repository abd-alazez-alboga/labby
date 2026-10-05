package com.labby.backend.repository;

import com.labby.backend.model.AuditLogEntry;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** Append-only audit log (RBAC-05): INSERT and filtered reads only — no update/delete exists. */
public interface AuditLogRepository
    extends JpaRepository<AuditLogEntry, UUID>, JpaSpecificationExecutor<AuditLogEntry> {}
