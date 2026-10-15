package com.labby.backend.controller;

import com.labby.backend.dto.AdminRideDetailDto;
import com.labby.backend.dto.AdminRideSummaryPageDto;
import com.labby.backend.enums.Permission;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.AdminRideService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.Instant;
import java.util.UUID;
import java.util.function.Function;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Admin ride search + inspection (UC-A-18) per rides-v1.yaml. */
@RestController
@RequestMapping("/api/v1/admin/rides")
@Tag(name = "AdminRides", description = "Search and inspect rides")
@RequiredArgsConstructor
public class AdminRidesController {

  private final AdminRideService adminRideService;

  /**
   * Searches rides.
   *
   * @param regionId region filter
   * @param state state filter
   * @param kind kind filter
   * @param userId rider or driver
   * @param phone rider or driver phone
   * @param from requestedAt lower bound (inclusive)
   * @param to requestedAt upper bound (exclusive)
   * @param page zero-based page
   * @param size page size (1..100)
   * @return 200 with one page
   */
  @GetMapping
  @PreAuthorize("hasAuthority('rides:view')")
  @Operation(summary = "Search rides (UC-A-18)")
  public ResponseEntity<AdminRideSummaryPageDto> search(
      @RequestParam(required = false) UUID regionId,
      @RequestParam(required = false) String state,
      @RequestParam(required = false) String kind,
      @RequestParam(required = false) UUID userId,
      @RequestParam(required = false) String phone,
      @RequestParam(required = false) Instant from,
      @RequestParam(required = false) Instant to,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    AdminRideService.Filter filter =
        new AdminRideService.Filter(
            regionId,
            parse(state, RideState::fromValue, "state"),
            parse(kind, RideKind::fromValue, "kind"),
            userId,
            phone,
            from,
            to);
    return ResponseEntity.ok(
        adminRideService.search(filter, Math.max(0, page), Math.clamp(size, 1, 100)));
  }

  private static <T> T parse(String value, Function<String, T> parser, String name) {
    if (value == null) {
      return null;
    }
    try {
      return parser.apply(value);
    } catch (IllegalArgumentException ex) {
      throw new InvalidRequestException("Unknown " + name + ": " + value);
    }
  }

  /**
   * The full truth of one ride. Party phones are contact access (UC-A-20): served only to admins
   * holding {@code support:handle}, null for everyone else.
   *
   * @param rideId the ride
   * @param authentication the caller
   * @return 200 with the detail
   */
  @GetMapping("/{rideId}")
  @PreAuthorize("hasAuthority('rides:view')")
  @Operation(summary = "Timeline, trace, offers trail, fare (UC-A-18)")
  public ResponseEntity<AdminRideDetailDto> detail(
      @PathVariable UUID rideId, Authentication authentication) {
    AdminRideDetailDto detail = adminRideService.detail(rideId);
    boolean contactAccess =
        SecurityUtils.holds(authentication, Permission.SUPPORT_HANDLE.getValue());
    return ResponseEntity.ok(contactAccess ? detail : detail.withoutPhones());
  }
}
