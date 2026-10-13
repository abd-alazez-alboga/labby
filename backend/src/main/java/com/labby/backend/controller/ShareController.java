package com.labby.backend.controller;

import com.labby.backend.dto.ShareLinkDto;
import com.labby.backend.dto.SharePageDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.ShareService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Trip sharing (comms-v1.yaml Share, SHARE-01/02, UC-S-15). The data endpoint and the minimal
 * server-rendered page are PUBLIC — whitelisted in the security chain; the unguessable token is the
 * only capability. The page itself never embeds the token in markup (it reads its own URL), so
 * nothing user-controlled is interpolated into HTML.
 */
@RestController
@RequestMapping
@Tag(name = "Share", description = "Trip-share links and the public live trip view")
@RequiredArgsConstructor
public class ShareController {

  /**
   * The share web page (SHARE-02): no login, no app chrome — a static shell polling the JSON
   * endpoint every {@code refreshSeconds}. The token stays in the URL; the page reads it with
   * {@code location.pathname}.
   */
  private static final String PAGE =
      """
      <!doctype html>
      <html lang="en">
      <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="robots" content="noindex">
      <title>Labby — Live trip</title>
      <style>
        body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; margin: 0;
               background: #f5f5f5; color: #111; }
        header { background: #59128A; color: #fff; padding: 16px; font-weight: 700; }
        main { max-width: 480px; margin: 0 auto; padding: 16px; }
        .card { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 12px;
                box-shadow: 0 1px 3px rgba(0,0,0,.08); }
        .status { font-weight: 700; color: #59128A; }
        .muted { color: #666; font-size: 14px; }
        img.photo { width: 56px; height: 56px; border-radius: 50%; object-fit: cover;
                    vertical-align: middle; margin-right: 12px; }
        a.map { color: #59128A; font-weight: 700; text-decoration: none; }
      </style>
      </head>
      <body>
      <header>Labby — Live trip</header>
      <main>
        <div class="card"><span id="status" class="status">Loading…</span>
          <div id="eta" class="muted"></div></div>
        <div class="card" id="driver" hidden>
          <img id="photo" class="photo" alt="" hidden>
          <strong id="name"></strong>
          <div id="vehicle" class="muted"></div></div>
        <div class="card" id="where" hidden>
          <a id="maplink" class="map" target="_blank" rel="noopener">View current position on map</a>
          <div id="fix" class="muted"></div></div>
      </main>
      <script>
      (function () {
        var statusNames = { accepted: 'Driver on the way', driver_arrived: 'Driver arrived',
                            in_progress: 'Trip in progress' };
        var dead = false;
        function show(id, on) { document.getElementById(id).hidden = !on; }
        function text(id, value) { document.getElementById(id).textContent = value; }
        function render(page) {
          text('status', statusNames[page.status] || page.status);
          text('eta', page.etaSeconds == null ? '' :
               'ETA about ' + Math.max(1, Math.round(page.etaSeconds / 60)) + ' min');
          show('driver', true);
          text('name', page.driverFirstName);
          var photo = document.getElementById('photo');
          if (page.driverPhotoUrl) { photo.src = page.driverPhotoUrl; photo.hidden = false; }
          text('vehicle', page.vehicle.model + ' · ' + page.vehicle.color + ' · ' +
               page.vehicle.plate);
          if (page.position) {
            show('where', true);
            document.getElementById('maplink').href = 'https://www.openstreetmap.org/?mlat=' +
              page.position.lat + '&mlon=' + page.position.lng + '#map=16/' +
              page.position.lat + '/' + page.position.lng;
            text('fix', 'As of ' + new Date(page.position.recordedAt).toLocaleTimeString());
          } else {
            show('where', false);
          }
        }
        function ended(message) {
          dead = true;
          text('status', message);
          text('eta', '');
          show('driver', false);
          show('where', false);
        }
        function poll() {
          if (dead) { return; }
          fetch('/api/v1/share/' + location.pathname.split('/').pop())
            .then(function (response) {
              if (response.status === 410) { ended('This trip has ended.'); return null; }
              if (!response.ok) { ended('This link is not valid.'); return null; }
              return response.json();
            })
            .then(function (page) {
              if (!page) { return; }
              render(page);
              setTimeout(poll, (page.refreshSeconds || 5) * 1000);
            })
            .catch(function () { setTimeout(poll, 5000); });
        }
        poll();
      })();
      </script>
      </body>
      </html>
      """;

  private final ShareService shareService;

  /**
   * Creates the caller's trip-share link (SHARE-01) — the only time the raw url is served.
   *
   * @param rideId the ride
   * @return 201 with the url; 403 not a party; 409 ride_not_active / already_shared
   */
  @PostMapping("/api/v1/rides/{rideId}/share-links")
  @Operation(summary = "Create the caller's trip-share link (SHARE-01)")
  public ResponseEntity<ShareLinkDto> create(@PathVariable UUID rideId) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(shareService.create(SecurityUtils.currentUserId(), rideId));
  }

  /**
   * The public share-page data — NO authentication (SHARE-02).
   *
   * @param token the raw url token
   * @return 200 with exactly the SHARE-02 list; 404 unknown; 410 once the ride is terminal
   */
  @GetMapping("/api/v1/share/{token}")
  @Operation(summary = "Public share-page data (SHARE-02, no auth)")
  public ResponseEntity<SharePageDto> page(@PathVariable String token) {
    return ResponseEntity.ok(shareService.page(token));
  }

  /**
   * The minimal public share page polling the data endpoint (SHARE-02) — no login, no app chrome.
   *
   * @param token the raw url token (consumed client-side from the URL, never interpolated)
   * @return 200 with the HTML shell
   */
  @GetMapping(value = "/share/{token}", produces = MediaType.TEXT_HTML_VALUE)
  @Operation(summary = "Public share web page (SHARE-02, no auth)")
  public ResponseEntity<String> html(@PathVariable String token) {
    return ResponseEntity.ok().contentType(MediaType.TEXT_HTML).body(PAGE);
  }
}
