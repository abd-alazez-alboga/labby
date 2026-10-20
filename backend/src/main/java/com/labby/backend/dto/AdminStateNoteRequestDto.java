package com.labby.backend.dto;

import jakarta.validation.constraints.Size;

/**
 * The optional body of an admin deactivate / reactivate (V1 audit W10): a note shown to the admin
 * in the notification they get (USR-04).
 *
 * @param note the reason, or null
 */
public record AdminStateNoteRequestDto(@Size(max = 500) String note) {}
