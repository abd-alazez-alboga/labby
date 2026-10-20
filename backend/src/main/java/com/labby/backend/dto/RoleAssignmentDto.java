package com.labby.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import com.labby.backend.enums.SuspensionReason;
import java.time.Instant;
import java.util.List;

/**
 * A role held by the account with its per-role state (USR-01, USR-04). On the {@code admin}
 * assignment only, {@code rbacRole} and {@code permissions} expose the single RBAC role and its
 * {@code domain:action} codes so the admin UI can gate routes/menus (RBAC-03); absent elsewhere.
 * Enforcement stays server-side per request — these fields refresh on the next profile fetch.
 * {@code suspensionReason} is present only while the role is suspended with a recorded reason
 * (USR-04; M5's {@code document_expired}, M11's {@code low_rating} and {@code manual}); {@code
 * suspensionNote} is the admin's reason of a {@code manual} suspension, shown to the user. {@code
 * suspendedAt} is when the role was suspended, present only while it is (V1 conformance W5 / I31:
 * the deactivated admin's "access deactivated" screen shows the Super Admin's note and this date;
 * an admin deactivated without a note carries no reason and no note).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record RoleAssignmentDto(
    Role role,
    RoleState state,
    SuspensionReason suspensionReason,
    String suspensionNote,
    Instant suspendedAt,
    RoleSummaryDto rbacRole,
    List<String> permissions) {}
