package com.labby.backend.service;

import java.util.UUID;

/**
 * Published inside the SOS transaction (SAFE-01); handled after commit to start an immediate outbox
 * pass, so the admin alert does not wait for the next dispatcher tick.
 *
 * @param sosEventId the recorded event
 */
public record SosTriggeredEvent(UUID sosEventId) {}
