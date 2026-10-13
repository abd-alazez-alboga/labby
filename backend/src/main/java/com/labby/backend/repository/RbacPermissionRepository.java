package com.labby.backend.repository;

import com.labby.backend.model.RbacPermission;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** The code-seeded permission catalog (RBAC-02). */
public interface RbacPermissionRepository extends JpaRepository<RbacPermission, UUID> {

  List<RbacPermission> findAllByOrderByCodeAsc();

  List<RbacPermission> findByCodeIn(List<String> codes);

  /**
   * Resolves the {@code domain:action} authorities of a user's ACTIVE admin role assignment,
   * evaluated fresh per request so role edits take effect instantly (RBAC-02).
   *
   * @param userId the account id
   * @return the permission codes; empty when the user holds no active admin role
   */
  @Query(
      value =
          "SELECT p.code FROM role_assignments ra"
              + " JOIN role_permissions rp ON rp.role_id = ra.admin_role_id"
              + " JOIN permissions p ON p.permission_id = rp.permission_id"
              + " WHERE ra.user_id = :userId AND ra.role = 'admin' AND ra.state = 'active'",
      nativeQuery = true)
  List<String> findCodesForActiveAdmin(@Param("userId") UUID userId);

  /**
   * The accounts holding an ACTIVE admin role that grants the permission — the SOS alert fan-out
   * target set (SAFE-01: every admin holding {@code support:handle}, and only those).
   *
   * @param code the {@code domain:action} permission code
   * @return the admin account ids
   */
  @Query(
      value =
          "SELECT DISTINCT ra.user_id FROM role_assignments ra"
              + " JOIN role_permissions rp ON rp.role_id = ra.admin_role_id"
              + " JOIN permissions p ON p.permission_id = rp.permission_id"
              + " WHERE p.code = :code AND ra.role = 'admin' AND ra.state = 'active'",
      nativeQuery = true)
  List<UUID> findActiveAdminIdsWithPermission(@Param("code") String code);
}
