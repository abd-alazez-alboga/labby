package com.labby.backend.service;

import com.labby.backend.dto.ServiceTypeDto;
import com.labby.backend.dto.ServiceTypeUpsertRequestDto;
import java.util.List;
import java.util.UUID;

/**
 * A region's service types with their pricing (PRC-01, UC-A-07). Types are never deleted —
 * disabling removes them from booking while existing rides keep referencing them. Every mutation is
 * audited (RBAC-05, actions {@code service_type.*}).
 */
public interface ServiceTypeService {

  /**
   * Lists a region's service types, enabled and disabled.
   *
   * @param regionId the region
   * @return the types, name-sorted
   */
  List<ServiceTypeDto> listServiceTypes(UUID regionId);

  /**
   * Adds a service type with its pricing (UC-A-07); the English name is unique per region (409).
   *
   * @param actorUserId the acting admin
   * @param regionId the region
   * @param request the type with its pricing
   * @return the created type
   */
  ServiceTypeDto createServiceType(
      UUID actorUserId, UUID regionId, ServiceTypeUpsertRequestDto request);

  /**
   * Edits or disables a service type (UC-A-07). Disabling with claimed scheduled rides returns the
   * E1 warning once scheduled rides exist (M12); until then the disable always succeeds.
   *
   * @param actorUserId the acting admin
   * @param serviceTypeId the type
   * @param request the replacement values
   * @return the updated type
   */
  ServiceTypeDto updateServiceType(
      UUID actorUserId, UUID serviceTypeId, ServiceTypeUpsertRequestDto request);
}
