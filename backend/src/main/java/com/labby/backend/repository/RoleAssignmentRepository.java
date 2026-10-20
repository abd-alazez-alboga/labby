package com.labby.backend.repository;

import com.labby.backend.enums.Role;
import com.labby.backend.model.RoleAssignment;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Role assignments per account (USR-01, USR-04). */
public interface RoleAssignmentRepository extends JpaRepository<RoleAssignment, UUID> {

  List<RoleAssignment> findByUserId(UUID userId);

  boolean existsByUserIdAndRole(UUID userId, Role role);

  Optional<RoleAssignment> findByUserIdAndRole(UUID userId, Role role);

  /**
   * The role row locked FOR UPDATE: serializes the expiry job's suspension against renewal/switch
   * approvals' reinstatement, so neither decides on a stale view of the driver's documents.
   */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("SELECT r FROM RoleAssignment r WHERE r.userId = :userId AND r.role = :role")
  Optional<RoleAssignment> findForUpdate(@Param("userId") UUID userId, @Param("role") Role role);

  List<RoleAssignment> findByRoleOrderByGrantedAtAsc(Role role);

  boolean existsByAdminRoleId(UUID adminRoleId);

  long countByAdminRoleId(UUID adminRoleId);

  /**
   * Locks every admin assignment of an RBAC role FOR UPDATE (review V1 W9): the last-Super-Admin
   * guard takes it before counting, so two demotions / deactivations / deletions of Super Admins
   * run one after the other and the second counts what the first committed.
   *
   * @param adminRoleId the RBAC role
   * @return the locked assignment ids
   */
  @Query(
      value =
          "SELECT role_assignment_id FROM role_assignments WHERE role = 'admin'"
              + " AND admin_role_id = :adminRoleId ORDER BY role_assignment_id FOR UPDATE",
      nativeQuery = true)
  List<UUID> lockAdminAssignments(@Param("adminRoleId") UUID adminRoleId);

  /**
   * Holders of an RBAC role whose assignment AND account are both active (review V1 W9): a deleted
   * account's lingering assignment protects nothing.
   *
   * @param adminRoleId the RBAC role
   * @return the count
   */
  @Query(
      value =
          "SELECT count(*) FROM role_assignments ra JOIN users u ON u.user_id = ra.user_id"
              + " WHERE ra.role = 'admin' AND ra.admin_role_id = :adminRoleId"
              + " AND ra.state = 'active' AND u.state = 'active'",
      nativeQuery = true)
  long countActiveHolders(@Param("adminRoleId") UUID adminRoleId);

  /**
   * Whether the account actively holds an RBAC role (assignment and account both active).
   *
   * @param userId the account
   * @param adminRoleId the RBAC role
   * @return true when it does
   */
  @Query(
      value =
          "SELECT EXISTS (SELECT 1 FROM role_assignments ra JOIN users u ON u.user_id = ra.user_id"
              + " WHERE ra.user_id = :userId AND ra.role = 'admin'"
              + " AND ra.admin_role_id = :adminRoleId AND ra.state = 'active'"
              + " AND u.state = 'active')",
      nativeQuery = true)
  boolean isActiveHolder(@Param("userId") UUID userId, @Param("adminRoleId") UUID adminRoleId);
}
