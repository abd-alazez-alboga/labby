package com.labby.backend.repository;

import com.labby.backend.enums.Role;
import com.labby.backend.model.RoleAssignment;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Role assignments per account (USR-01, USR-04). */
public interface RoleAssignmentRepository extends JpaRepository<RoleAssignment, UUID> {

  List<RoleAssignment> findByUserId(UUID userId);

  boolean existsByUserIdAndRole(UUID userId, Role role);
}
