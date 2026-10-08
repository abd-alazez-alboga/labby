package com.labby.backend.service;

import com.labby.backend.dto.SavedLocationDto;
import com.labby.backend.dto.SavedLocationUpsertRequestDto;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.SavedLocation;
import com.labby.backend.repository.SavedLocationRepository;
import com.labby.backend.util.GeoPoints;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Saved places; another rider's place is a plain 404 (never revealed). */
@Service
@Transactional
@RequiredArgsConstructor
public class SavedLocationServiceImpl implements SavedLocationService {

  private static final String NOT_FOUND = "Saved place not found";

  private final SavedLocationRepository savedLocationRepository;
  private final RideAccess rideAccess;

  @Override
  @Transactional(readOnly = true)
  public List<SavedLocationDto> list(UUID userId) {
    rideAccess.requireRider(userId);
    return savedLocationRepository.findByRiderUserIdOrderByNameAsc(userId).stream()
        .map(SavedLocationServiceImpl::toDto)
        .toList();
  }

  @Override
  public SavedLocationDto create(UUID userId, SavedLocationUpsertRequestDto request) {
    rideAccess.requireRider(userId);
    String name = request.name().trim();
    if (savedLocationRepository.existsByRiderUserIdAndNameIgnoreCase(userId, name)) {
      throw duplicate();
    }
    SavedLocation saved =
        savedLocationRepository.saveAndFlush(
            SavedLocation.builder()
                .riderUserId(userId)
                .name(name)
                .position(GeoPoints.point(request.lat(), request.lng()))
                .address(request.address())
                .build());
    return toDto(saved);
  }

  @Override
  public SavedLocationDto update(
      UUID userId, UUID savedLocationId, SavedLocationUpsertRequestDto request) {
    rideAccess.requireRider(userId);
    SavedLocation location =
        savedLocationRepository
            .findByIdAndRiderUserId(savedLocationId, userId)
            .orElseThrow(() -> new ResourceNotFoundException(NOT_FOUND));
    String name = request.name().trim();
    if (savedLocationRepository.existsByRiderUserIdAndNameIgnoreCaseAndIdNot(
        userId, name, savedLocationId)) {
      throw duplicate();
    }
    location.setName(name);
    location.setPosition(GeoPoints.point(request.lat(), request.lng()));
    location.setAddress(request.address());
    return toDto(savedLocationRepository.saveAndFlush(location));
  }

  @Override
  public void delete(UUID userId, UUID savedLocationId) {
    rideAccess.requireRider(userId);
    SavedLocation location =
        savedLocationRepository
            .findByIdAndRiderUserId(savedLocationId, userId)
            .orElseThrow(() -> new ResourceNotFoundException(NOT_FOUND));
    savedLocationRepository.delete(location);
  }

  private static ConflictException duplicate() {
    return (ConflictException)
        new ConflictException("You already have a saved place with this name")
            .withCode("duplicate_name");
  }

  private static SavedLocationDto toDto(SavedLocation location) {
    return new SavedLocationDto(
        location.getId(),
        location.getName(),
        location.getPosition().getY(),
        location.getPosition().getX(),
        location.getAddress());
  }
}
