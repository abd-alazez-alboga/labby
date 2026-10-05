package com.labby.backend.service;

import com.labby.backend.dto.ServiceTypeDto;
import com.labby.backend.dto.ServiceTypeUpsertRequestDto;
import com.labby.backend.exception.ResourceAlreadyExistsException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.ServiceType;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Service-type CRUD per UC-A-07: unique English name per region, disable instead of delete. Every
 * mutation is audited (RBAC-05).
 */
@Service
@RequiredArgsConstructor
public class ServiceTypeServiceImpl implements ServiceTypeService {

  private static final String TARGET_TYPE_SERVICE_TYPE = "service_type";

  private final ServiceTypeRepository serviceTypeRepository;
  private final RegionRepository regionRepository;
  private final AuditService auditService;

  @Override
  @Transactional(readOnly = true)
  public List<ServiceTypeDto> listServiceTypes(UUID regionId) {
    requireRegion(regionId);
    return serviceTypeRepository.findByRegionIdOrderByNameEnAsc(regionId).stream()
        .map(this::toDto)
        .toList();
  }

  @Override
  @Transactional
  public ServiceTypeDto createServiceType(
      UUID actorUserId, UUID regionId, ServiceTypeUpsertRequestDto request) {
    requireRegion(regionId);
    if (serviceTypeRepository.existsByRegionIdAndNameEnIgnoreCase(regionId, request.nameEn())) {
      throw new ResourceAlreadyExistsException("Service type", "nameEn", request.nameEn());
    }
    ServiceType serviceType =
        ServiceType.builder().regionId(regionId).createdBy(actorUserId).build();
    apply(serviceType, request, actorUserId);
    ServiceType saved = serviceTypeRepository.save(serviceType);
    auditService.record(
        actorUserId,
        "service_type.create",
        TARGET_TYPE_SERVICE_TYPE,
        saved.getId().toString(),
        null,
        snapshot(saved));
    return toDto(saved);
  }

  @Override
  @Transactional
  public ServiceTypeDto updateServiceType(
      UUID actorUserId, UUID serviceTypeId, ServiceTypeUpsertRequestDto request) {
    ServiceType serviceType =
        serviceTypeRepository
            .findById(serviceTypeId)
            .orElseThrow(() -> new ResourceNotFoundException("Service type", serviceTypeId));
    if (serviceTypeRepository.existsByRegionIdAndNameEnIgnoreCaseAndIdNot(
        serviceType.getRegionId(), request.nameEn(), serviceTypeId)) {
      throw new ResourceAlreadyExistsException("Service type", "nameEn", request.nameEn());
    }
    Map<String, Object> before = snapshot(serviceType);
    apply(serviceType, request, actorUserId);
    ServiceType saved = serviceTypeRepository.save(serviceType);
    auditService.record(
        actorUserId,
        "service_type.update",
        TARGET_TYPE_SERVICE_TYPE,
        saved.getId().toString(),
        before,
        snapshot(saved));
    return toDto(saved);
  }

  private void requireRegion(UUID regionId) {
    if (!regionRepository.existsById(regionId)) {
      throw new ResourceNotFoundException("Region", regionId);
    }
  }

  private void apply(ServiceType serviceType, ServiceTypeUpsertRequestDto request, UUID actor) {
    serviceType.setNameEn(request.nameEn());
    serviceType.setNameAr(request.nameAr());
    serviceType.setBaseFare(request.baseFare());
    serviceType.setPerKmRate(request.perKmRate());
    serviceType.setPerMinRate(request.perMinRate());
    serviceType.setMinimumFare(request.minimumFare());
    serviceType.setEnabled(request.enabled());
    serviceType.setUpdatedBy(actor);
  }

  private ServiceTypeDto toDto(ServiceType serviceType) {
    return new ServiceTypeDto(
        serviceType.getId(),
        serviceType.getRegionId(),
        serviceType.getNameEn(),
        serviceType.getNameAr(),
        serviceType.getBaseFare(),
        serviceType.getPerKmRate(),
        serviceType.getPerMinRate(),
        serviceType.getMinimumFare(),
        serviceType.isEnabled());
  }

  private Map<String, Object> snapshot(ServiceType serviceType) {
    Map<String, Object> snapshot = new LinkedHashMap<>();
    snapshot.put("nameEn", serviceType.getNameEn());
    snapshot.put("nameAr", serviceType.getNameAr());
    snapshot.put("baseFare", serviceType.getBaseFare());
    snapshot.put("perKmRate", serviceType.getPerKmRate());
    snapshot.put("perMinRate", serviceType.getPerMinRate());
    snapshot.put("minimumFare", serviceType.getMinimumFare());
    snapshot.put("enabled", serviceType.isEnabled());
    return snapshot;
  }
}
