package com.labby.backend.service;

import com.labby.backend.dto.ApproveRequestDto;
import com.labby.backend.dto.ReasonRequestDto;
import com.labby.backend.dto.VehicleReviewDto;
import com.labby.backend.dto.VehicleReviewSummaryDto;
import com.labby.backend.dto.VehicleSwitchRequestDto;
import com.labby.backend.dto.VehicleWithDocumentsDto;
import java.util.List;
import java.util.UUID;

/**
 * Vehicle switching with re-review (DRV-03, UC-D-18, UC-A-11) per onboarding-v1.yaml: the current
 * vehicle stays active until the switch is approved; one switch at a time.
 */
public interface DriverVehicleService {

  /**
   * The driver's own vehicles with their documents, newest first.
   *
   * @param userId the driver
   * @return the vehicles
   */
  List<VehicleWithDocumentsDto> listOwnVehicles(UUID userId);

  /**
   * Submits a vehicle switch (approved drivers only).
   *
   * @param userId the driver
   * @param request the new vehicle + registration + insurance
   * @return the pending vehicle
   */
  VehicleWithDocumentsDto submitSwitch(UUID userId, VehicleSwitchRequestDto request);

  /**
   * The switch queue, oldest first.
   *
   * @return pending switch vehicles of approved drivers
   */
  List<VehicleReviewSummaryDto> listSwitchQueue();

  /**
   * One pending switch beside the current vehicle.
   *
   * @param vehicleId the switch vehicle
   * @return the switch
   */
  VehicleReviewDto getSwitch(UUID vehicleId);

  /**
   * Approves a switch: the new vehicle becomes the single active one with the given service types.
   *
   * @param actorUserId the reviewer
   * @param vehicleId the switch vehicle
   * @param request the service types
   * @return the switch
   */
  VehicleReviewDto approveSwitch(UUID actorUserId, UUID vehicleId, ApproveRequestDto request);

  /**
   * Rejects a switch; the driver keeps the current vehicle.
   *
   * @param actorUserId the reviewer
   * @param vehicleId the switch vehicle
   * @param request the reason
   * @return the switch
   */
  VehicleReviewDto rejectSwitch(UUID actorUserId, UUID vehicleId, ReasonRequestDto request);
}
