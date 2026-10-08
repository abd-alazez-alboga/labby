package com.labby.backend.controller;

import com.labby.backend.dto.RideDto;
import com.labby.backend.dto.RideOfferDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.DriverRideService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Ride offers to a driver (RIDE-03, UC-D-06) per rides-v1.yaml. */
@RestController
@RequestMapping("/api/v1/driver/offers")
@Tag(name = "DriverOffers", description = "Open offer, accept, decline")
@RequiredArgsConstructor
public class DriverOffersController {

  private final DriverRideService driverRideService;

  /**
   * The driver's open offer.
   *
   * @return 200 with the offer, or 204
   */
  @GetMapping("/open")
  @Operation(summary = "The open offer, or 204")
  public ResponseEntity<RideOfferDto> open() {
    return driverRideService
        .openOffer(SecurityUtils.currentUserId())
        .map(ResponseEntity::ok)
        .orElseGet(() -> ResponseEntity.noContent().build());
  }

  /**
   * Accepts an offer.
   *
   * @param offerId the offer
   * @return 200 with the ride; 409 offer_closed
   */
  @PostMapping("/{offerId}/accept")
  @Operation(summary = "Accept the open offer (transition 5)")
  public ResponseEntity<RideDto> accept(@PathVariable UUID offerId) {
    return ResponseEntity.ok(driverRideService.accept(SecurityUtils.currentUserId(), offerId));
  }

  /**
   * Declines an offer.
   *
   * @param offerId the offer
   * @return 204; 409 offer_closed
   */
  @PostMapping("/{offerId}/decline")
  @Operation(summary = "Decline the open offer")
  public ResponseEntity<Void> decline(@PathVariable UUID offerId) {
    driverRideService.decline(SecurityUtils.currentUserId(), offerId);
    return ResponseEntity.noContent().build();
  }
}
