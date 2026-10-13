package com.labby.backend.repository.projection;

import java.util.UUID;

/** One fresh online driver dot of the live ops map (ADM-03). */
public interface LiveOpsDriverRow {

  UUID getDriverUserId();

  String getName();

  double getLat();

  double getLng();

  Double getHeadingDeg();
}
