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
   * The share web page (SHARE-02, owner-approved SharePage artboard): no login, no app chrome — a
   * static shell polling the JSON endpoint every {@code refreshSeconds}, moving the driver's marker
   * on a Leaflet map (1.9.4 from unpkg, SRI-pinned like the apps; public OSM tiles — the backend
   * has no tile-url property). The token stays in the URL; the page reads it with {@code
   * location.pathname}, and every server value is set as text, never as markup.
   */
  private static final String PAGE =
      """
      <!doctype html>
      <html lang="en">
      <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
      <meta name="robots" content="noindex">
      <title>Labby — Live trip</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
            integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
      <style>
        * { box-sizing: border-box; }
        html, body { height: 100%; margin: 0; }
        body { font-family: 'Manrope', -apple-system, 'Segoe UI', Roboto, sans-serif;
               background: #F4F4F6; color: #141018; display: flex; justify-content: center; }
        .app { position: relative; width: 100%; max-width: 480px; height: 100%; background: #fff;
               display: flex; flex-direction: column; overflow: hidden; }
        .top { display: flex; align-items: center; gap: 10px; background: #fff; z-index: 2;
               padding: calc(12px + env(safe-area-inset-top)) 16px 12px; }
        .logo { width: 32px; height: 32px; border-radius: 9px; background: #59128A; color: #fff;
                display: grid; place-items: center; font-weight: 800; font-size: 18px; }
        .brand { font-weight: 800; font-size: 18px; letter-spacing: -0.2px; }
        .live { margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
                background: #E8F6EC; color: #157A3B; border-radius: 999px; padding: 6px 12px;
                font-weight: 700; font-size: 13px; }
        .live .dot { width: 8px; height: 8px; border-radius: 50%; background: #1FA34A; }
        .live[hidden] { display: none; }
        #map { flex: 1; min-height: 240px; background: #ECECEF; z-index: 1; }
        .sheet { background: #fff; border-radius: 20px 20px 0 0; margin-top: -20px; z-index: 2;
                 position: relative; box-shadow: 0 -4px 20px rgba(20,16,24,.08);
                 padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); }
        .driver { display: flex; align-items: center; gap: 14px; }
        .avatar { width: 56px; height: 56px; border-radius: 50%; flex: none; overflow: hidden;
                  background: #F1EAF8; color: #59128A; display: grid; place-items: center;
                  font-weight: 800; font-size: 22px; }
        .avatar img { width: 100%; height: 100%; object-fit: cover; }
        .who { font-weight: 800; font-size: 18px; }
        .car { color: #5C5763; font-size: 14px; font-weight: 600; margin-top: 2px; }
        .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
        .tile { background: #F4F4F6; border-radius: 14px; padding: 12px 14px; }
        .tile .label { color: #5C5763; font-size: 12px; font-weight: 700; }
        .tile .value { font-weight: 800; font-size: 16px; margin-top: 4px; }
        .note { color: #5C5763; font-size: 12px; font-weight: 500; margin: 14px 0 0;
                line-height: 1.5; }
        .ended { font-weight: 800; font-size: 20px; text-align: center; padding: 24px 0; }
        .pin { width: 22px; height: 22px; border-radius: 50%; background: #59128A;
               border: 4px solid #fff; box-shadow: 0 2px 8px rgba(20,16,24,.35); }
        [hidden] { display: none !important; }
      </style>
      </head>
      <body>
      <div class="app">
        <header class="top">
          <div class="logo">L</div><div class="brand">Labby</div>
          <span class="live" id="live" hidden><span class="dot"></span>Live</span>
        </header>
        <div id="map"></div>
        <section class="sheet">
          <div id="trip">
            <div class="driver">
              <div class="avatar" id="avatar"></div>
              <div><div class="who" id="who">Loading…</div>
                <div class="car" id="car"></div></div>
            </div>
            <div class="tiles">
              <div class="tile"><div class="label">Status</div>
                <div class="value" id="status">—</div></div>
              <div class="tile"><div class="label">Arriving</div>
                <div class="value" id="eta">—</div></div>
            </div>
          </div>
          <div class="ended" id="ended" hidden></div>
          <p class="note">This page updates live and stops working when the trip ends.
            No sign-in needed.</p>
        </section>
      </div>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
              integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
      <script>
      (function () {
        var statusNames = { accepted: 'Driver on the way', driver_arrived: 'Driver arrived',
                            in_progress: 'On the ride' };
        var dead = false, map = null, marker = null, photoShown = false;
        function el(id) { return document.getElementById(id); }
        function text(id, value) { el(id).textContent = value; }
        function place(position) {
          if (!position || !window.L) { return; }
          var at = [position.lat, position.lng];
          if (!map) {
            map = L.map('map', { zoomControl: false }).setView(at, 16);
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
              attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">' +
                           'OpenStreetMap</a> contributors' }).addTo(map);
            marker = L.marker(at, { icon: L.divIcon({ className: '', html: '<div class="pin"></div>',
                                                      iconSize: [22, 22] }) }).addTo(map);
          } else {
            marker.setLatLng(at);
            map.panTo(at);
          }
        }
        function render(page) {
          el('live').hidden = false;
          text('who', page.driverFirstName + ' is driving');
          var car = el('car');
          car.textContent = page.vehicle.color + ' ' + page.vehicle.model + ' · ';
          var plate = document.createElement('span');
          plate.dir = 'ltr';
          plate.textContent = page.vehicle.plate;
          car.appendChild(plate);
          var avatar = el('avatar');
          if (page.driverPhotoUrl && !photoShown) {
            var img = document.createElement('img');
            img.alt = '';
            img.src = page.driverPhotoUrl;
            avatar.textContent = '';
            avatar.appendChild(img);
            photoShown = true;
          } else if (!photoShown) {
            avatar.textContent = (page.driverFirstName || '').charAt(0).toUpperCase();
          }
          text('status', statusNames[page.status] || page.status);
          text('eta', page.etaSeconds == null ? '—' :
               Math.max(1, Math.round(page.etaSeconds / 60)) + ' min');
          place(page.position);
        }
        function ended(message) {
          dead = true;
          el('live').hidden = true;
          el('trip').hidden = true;
          text('ended', message);
          el('ended').hidden = false;
          if (marker) { marker.remove(); }
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
