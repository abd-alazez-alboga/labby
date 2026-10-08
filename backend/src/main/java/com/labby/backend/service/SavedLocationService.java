package com.labby.backend.service;

import com.labby.backend.dto.SavedLocationDto;
import com.labby.backend.dto.SavedLocationUpsertRequestDto;
import java.util.List;
import java.util.UUID;

/** A rider's saved places (UC-R-01). */
public interface SavedLocationService {

  /**
   * The rider's places by name.
   *
   * @param userId the rider
   * @return the places
   */
  List<SavedLocationDto> list(UUID userId);

  /**
   * Adds a place; a name the rider already uses (any case) is a 409 {@code duplicate_name}.
   *
   * @param userId the rider
   * @param request the place
   * @return the created place
   */
  SavedLocationDto create(UUID userId, SavedLocationUpsertRequestDto request);

  /**
   * Renames / moves one of the rider's places.
   *
   * @param userId the rider
   * @param savedLocationId the place
   * @param request the new values
   * @return the updated place
   */
  SavedLocationDto update(UUID userId, UUID savedLocationId, SavedLocationUpsertRequestDto request);

  /**
   * Deletes one of the rider's places.
   *
   * @param userId the rider
   * @param savedLocationId the place
   */
  void delete(UUID userId, UUID savedLocationId);
}
