package com.labby.backend.dto;

import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;

/** A role held by the account with its per-role state (USR-01, USR-04). */
public record RoleAssignmentDto(Role role, RoleState state) {}
