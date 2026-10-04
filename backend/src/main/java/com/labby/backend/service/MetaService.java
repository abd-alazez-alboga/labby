package com.labby.backend.service;

import com.labby.backend.dto.MetaResponseDto;

/** Provides public metadata about the running application. */
public interface MetaService {

  /**
   * Returns the application's name and version.
   *
   * @return the API metadata
   */
  MetaResponseDto getMeta();
}
