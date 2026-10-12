package com.labby.backend.repository;

import com.labby.backend.model.Settlement;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** The append-only settlement record (COM-04): INSERT only, never update or delete. */
public interface SettlementRepository extends JpaRepository<Settlement, UUID> {}
