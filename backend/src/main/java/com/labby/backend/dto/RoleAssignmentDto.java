package com.labby.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import java.util.List;

/**
 * A role held by the account with its per-role state (USR-01, USR-04). On the {@code admin}
 * assignment only, {@code rbacRole} and {@code permissions} expose the single RBAC role and its
 * {@code domain:action} codes so the admin UI can gate routes/menus (RBAC-03); absent elsewhere.
 * Enforcement stays server-side per request — these fields refresh on the next profile fetch.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record RoleAssignmentDto(
    Role role, RoleState state, RoleSummaryDto rbacRole, List<String> permissions) {}
