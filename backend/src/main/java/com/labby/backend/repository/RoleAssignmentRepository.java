package com.labby.backend.repository;

import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import com.labby.backend.model.RoleAssignment;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Role assignments per account (USR-01, USR-04). */
public interface RoleAssignmentRepository extends JpaRepository<RoleAssignment, UUID> {

  List<RoleAssignment> findByUserId(UUID userId);

  boolean existsByUserIdAndRole(UUID userId, Role role);

  Optional<RoleAssignment> findByUserIdAndRole(UUID userId, Role role);

  List<RoleAssignment> findByRoleOrderByGrantedAtAsc(Role role);

  boolean existsByAdminRoleId(UUID adminRoleId);

  long countByAdminRoleId(UUID adminRoleId);

  /** Active holders of an RBAC role — the last-Super-Admin guard (RBAC-01, UC-A-02 E1). */
  long countByRoleAndAdminRoleIdAndState(Role role, UUID adminRoleId, RoleState state);
}
