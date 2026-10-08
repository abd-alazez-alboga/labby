package com.labby.backend.controller;

import com.labby.backend.dto.SavedLocationDto;
import com.labby.backend.dto.SavedLocationUpsertRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.SavedLocationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** A rider's saved places (UC-R-01) per rides-v1.yaml. */
@RestController
@RequestMapping("/api/v1/rider/saved-locations")
@Tag(name = "SavedLocations", description = "Saved places")
@RequiredArgsConstructor
public class SavedLocationsController {

  private final SavedLocationService savedLocationService;

  /**
   * The rider's saved places.
   *
   * @return 200 with the places
   */
  @GetMapping
  @Operation(summary = "The rider's saved places, by name")
  public ResponseEntity<List<SavedLocationDto>> list() {
    return ResponseEntity.ok(savedLocationService.list(SecurityUtils.currentUserId()));
  }

  /**
   * Adds a saved place.
   *
   * @param request the place
   * @return 201 with the place; 409 duplicate_name
   */
  @PostMapping
  @Operation(summary = "Add a saved place")
  public ResponseEntity<SavedLocationDto> create(
      @Valid @RequestBody SavedLocationUpsertRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(savedLocationService.create(SecurityUtils.currentUserId(), request));
  }

  /**
   * Renames / moves a saved place.
   *
   * @param savedLocationId the place
   * @param request the new values
   * @return 200 with the place
   */
  @PutMapping("/{savedLocationId}")
  @Operation(summary = "Rename / move a saved place")
  public ResponseEntity<SavedLocationDto> update(
      @PathVariable UUID savedLocationId,
      @Valid @RequestBody SavedLocationUpsertRequestDto request) {
    return ResponseEntity.ok(
        savedLocationService.update(SecurityUtils.currentUserId(), savedLocationId, request));
  }

  /**
   * Deletes a saved place.
   *
   * @param savedLocationId the place
   * @return 204
   */
  @DeleteMapping("/{savedLocationId}")
  @Operation(summary = "Delete a saved place")
  public ResponseEntity<Void> delete(@PathVariable UUID savedLocationId) {
    savedLocationService.delete(SecurityUtils.currentUserId(), savedLocationId);
    return ResponseEntity.noContent().build();
  }
}
