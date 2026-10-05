package com.labby.backend.service;

import com.labby.backend.dto.SurchargeWindowDto;
import com.labby.backend.dto.SurchargeWindowUpsertRequestDto;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.SurchargeWindow;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.SurchargeWindowRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Surcharge-window CRUD (PRC-01); every mutation is audited (RBAC-05). */
@Service
@RequiredArgsConstructor
public class SurchargeWindowServiceImpl implements SurchargeWindowService {

  private static final String TARGET_TYPE_SURCHARGE_WINDOW = "surcharge_window";

  private final SurchargeWindowRepository surchargeWindowRepository;
  private final RegionRepository regionRepository;
  private final AuditService auditService;

  @Override
  @Transactional(readOnly = true)
  public List<SurchargeWindowDto> listSurchargeWindows(UUID regionId) {
    requireRegion(regionId);
    return surchargeWindowRepository.findByRegionIdOrderByStartsAtAsc(regionId).stream()
        .map(this::toDto)
        .toList();
  }

  @Override
  @Transactional
  public SurchargeWindowDto createSurchargeWindow(
      UUID actorUserId, UUID regionId, SurchargeWindowUpsertRequestDto request) {
    requireRegion(regionId);
    SurchargeWindow window =
        SurchargeWindow.builder().regionId(regionId).createdBy(actorUserId).build();
    apply(window, request, actorUserId);
    SurchargeWindow saved = surchargeWindowRepository.save(window);
    auditService.record(
        actorUserId,
        "surcharge_window.create",
        TARGET_TYPE_SURCHARGE_WINDOW,
        saved.getId().toString(),
        null,
        snapshot(saved));
    return toDto(saved);
  }

  @Override
  @Transactional
  public SurchargeWindowDto updateSurchargeWindow(
      UUID actorUserId, UUID surchargeWindowId, SurchargeWindowUpsertRequestDto request) {
    SurchargeWindow window = requireWindow(surchargeWindowId);
    Map<String, Object> before = snapshot(window);
    apply(window, request, actorUserId);
    SurchargeWindow saved = surchargeWindowRepository.save(window);
    auditService.record(
        actorUserId,
        "surcharge_window.update",
        TARGET_TYPE_SURCHARGE_WINDOW,
        saved.getId().toString(),
        before,
        snapshot(saved));
    return toDto(saved);
  }

  @Override
  @Transactional
  public void deleteSurchargeWindow(UUID actorUserId, UUID surchargeWindowId) {
    SurchargeWindow window = requireWindow(surchargeWindowId);
    Map<String, Object> before = snapshot(window);
    surchargeWindowRepository.delete(window);
    auditService.record(
        actorUserId,
        "surcharge_window.delete",
        TARGET_TYPE_SURCHARGE_WINDOW,
        surchargeWindowId.toString(),
        before,
        null);
  }

  private void requireRegion(UUID regionId) {
    if (!regionRepository.existsById(regionId)) {
      throw new ResourceNotFoundException("Region", regionId);
    }
  }

  private SurchargeWindow requireWindow(UUID surchargeWindowId) {
    return surchargeWindowRepository
        .findById(surchargeWindowId)
        .orElseThrow(() -> new ResourceNotFoundException("Surcharge window", surchargeWindowId));
  }

  private void apply(SurchargeWindow window, SurchargeWindowUpsertRequestDto request, UUID actor) {
    window.setLabel(request.label());
    window.setStartsAt(request.startsAt());
    window.setEndsAt(request.endsAt());
    window.setDaysOfWeek(request.daysOfWeek());
    window.setPercent(request.percent());
    window.setUpdatedBy(actor);
  }

  private SurchargeWindowDto toDto(SurchargeWindow window) {
    return new SurchargeWindowDto(
        window.getId(),
        window.getRegionId(),
        window.getLabel(),
        window.getStartsAt(),
        window.getEndsAt(),
        window.getDaysOfWeek(),
        window.getPercent());
  }

  private Map<String, Object> snapshot(SurchargeWindow window) {
    Map<String, Object> snapshot = new LinkedHashMap<>();
    snapshot.put("label", window.getLabel());
    snapshot.put("startsAt", String.valueOf(window.getStartsAt()));
    snapshot.put("endsAt", String.valueOf(window.getEndsAt()));
    snapshot.put("daysOfWeek", window.getDaysOfWeek());
    snapshot.put("percent", window.getPercent());
    return snapshot;
  }
}
