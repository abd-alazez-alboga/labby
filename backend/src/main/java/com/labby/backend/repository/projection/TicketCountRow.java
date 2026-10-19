package com.labby.backend.repository.projection;

import java.util.UUID;

/** One per-ticket aggregate (a count, or a moment) over the thread table. */
public interface TicketCountRow {

  UUID getTicketId();

  long getCount();
}
