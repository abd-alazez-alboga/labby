package com.labby.backend.repository;

import com.labby.backend.model.RbacRole;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

/** Admin RBAC roles (RBAC-01/02). */
public interface RbacRoleRepository extends JpaRepository<RbacRole, UUID> {

  @EntityGraph(attributePaths = "permissions")
  List<RbacRole> findAllByOrderByNameAsc();

  @EntityGraph(attributePaths = "permissions")
  Optional<RbacRole> findWithPermissionsById(UUID id);

  boolean existsByNameIgnoreCase(String name);
}
