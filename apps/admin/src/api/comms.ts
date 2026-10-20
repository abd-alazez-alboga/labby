import type { ApiClient } from './client';
import type { GeoJsonPolygon } from './regions';
import type { AdminTicket, TicketPriority } from './support';

/**
 * Contract types and calls for the M10 comms & safety admin endpoints.
 * Source of truth: backend/docs/api/comms-v1.yaml — the live ops map feed
 * (ADM-03, `rides:view`), the SOS alert list + acknowledgement (UC-A-20,
 * `support:view` / `support:handle`) and the read-only chat log (CHAT-03,
 * `support:view`); the same codes the UI gates on.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Who triggered an SOS event (UC-A-20). */
export interface SosTriggeredBy {
  userId: string;
  name: string;
  /**
   * The caller's phone — contact access: served only to `support:handle`
   * holders, null for everyone else (owner ruling 2026-10-15).
   */
  phone: string | null;
}

/** The stand-down stamp; null while the alert is open. */
export interface SosAcknowledged {
  byUserId: string;
  byName: string;
  at: string;
  note?: string | null;
}

/** One SOS event as the admin surfaces see it (comms-v1.yaml AdminSosEvent). */
export interface AdminSosEvent {
  sosEventId: string;
  rideId: string;
  triggeredByRole: 'rider' | 'driver';
  lat: number;
  lng: number;
  /** Device moment, clamped to server time. */
  triggeredAt: string;
  createdAt: string;
  regionId: string;
  triggeredBy: SosTriggeredBy;
  rideState?: string;
  acknowledged: SosAcknowledged | null;
  /** The linked support ticket (support-v1 ruling 9); null until an admin opens one. */
  ticketId?: string | null;
}

export interface AdminSosEventPage {
  items: AdminSosEvent[];
  nextCursor: string | null;
}

export type SosStatusFilter = 'open' | 'acknowledged' | 'all';

export interface SosEventQuery {
  status?: SosStatusFilter;
  regionId?: string;
  before?: string;
  size?: number;
}

/** GET /admin/sos-events — newest first; support:view. */
export function listSosEvents(
  client: ApiClient,
  query: SosEventQuery = {},
): Promise<AdminSosEventPage> {
  const params = new URLSearchParams();
  if (query.status) {
    params.set('status', query.status);
  }
  if (query.regionId) {
    params.set('regionId', query.regionId);
  }
  if (query.before) {
    params.set('before', query.before);
  }
  if (query.size !== undefined) {
    params.set('size', String(query.size));
  }
  const search = params.toString();
  return client.get<AdminSosEventPage>(`/api/v1/admin/sos-events${search ? `?${search}` : ''}`);
}

/**
 * POST /admin/sos-events/{id}/acknowledge — stand-down with an optional note
 * (support:handle; audited). 409 code `already_acknowledged`.
 */
export function acknowledgeSosEvent(
  client: ApiClient,
  sosEventId: string,
  note?: string,
): Promise<AdminSosEvent> {
  return client.post<AdminSosEvent>(
    `/api/v1/admin/sos-events/${sosEventId}/acknowledge`,
    note ? { note } : undefined,
  );
}

/** support-v1 SosTicketRequest — `priority` omitted = the category's default. */
export interface SosTicketRequest {
  categoryId: string;
  description: string;
  priority?: TicketPriority;
}

/**
 * POST /admin/sos-events/{id}/ticket (support-v1, ruling 9) — opens the
 * linked support ticket on behalf of the SOS caller, about the SOS ride; it
 * starts in progress and assigned to the acting admin (support:handle;
 * audited `sos.ticket`). 409 codes `ticket_already_linked` (one per event),
 * `category_inactive`, `category_reserved`.
 */
export function openSosTicket(
  client: ApiClient,
  sosEventId: string,
  body: SosTicketRequest,
): Promise<AdminTicket> {
  return client.post<AdminTicket>(`/api/v1/admin/sos-events/${sosEventId}/ticket`, body);
}

/* ---------- Live ops map feed (ADM-03, UC-A-19) ---------- */

/** One online driver dot — idle (outline) vs on-ride (filled). */
export interface LiveOpsDriver {
  driverUserId: string;
  name: string;
  lat: number;
  lng: number;
  headingDeg?: number | null;
  status: 'idle' | 'on_ride';
  rideId?: string | null;
}

/** One active ride — the route line is pickup → stops → destination. */
export interface LiveOpsRide {
  rideId: string;
  state: string;
  pickup: LatLng;
  destination: LatLng;
  stops?: LatLng[];
  driverUserId?: string | null;
  /** Red flag — an unacknowledged SOS exists. */
  sosOpen: boolean;
}

/** One surge-overlay zone (the M9 state's shape: multiplier + level). */
export interface LiveOpsSurgeZone {
  id: string;
  name: string;
  polygon: GeoJsonPolygon;
  multiplier: number;
  level: number;
}

export interface LiveOps {
  regionId: string;
  serverTime: string;
  /** Poll pace (LIVEOPS_REFRESH_SECONDS, default 5). */
  refreshSeconds: number;
  drivers: LiveOpsDriver[];
  rides: LiveOpsRide[];
  surgeZones: LiveOpsSurgeZone[];
  /** OPEN events only — the red pins. */
  sosEvents: AdminSosEvent[];
}

/** GET /admin/regions/{regionId}/live-ops — one polled snapshot; rides:view. */
export function getLiveOps(client: ApiClient, regionId: string): Promise<LiveOps> {
  return client.get<LiveOps>(`/api/v1/admin/regions/${regionId}/live-ops`);
}

/* ---------- Chat log (CHAT-03) ---------- */

export type ChatWindowState = 'open' | 'read_only' | 'reopened';

export interface QuickReply {
  code: string;
  textEn: string;
  textAr: string;
}

export interface ChatMessage {
  messageId: string;
  senderRole: 'rider' | 'driver';
  kind: 'text' | 'quick_reply';
  body?: string | null;
  quickReply?: QuickReply | null;
  sentAt: string;
}

export interface AdminChatLog {
  rideId: string;
  windowState: ChatWindowState;
  openedAt: string;
  closedAt: string | null;
  /** Oldest first within the page. */
  items: ChatMessage[];
  nextCursor: string | null;
}

/**
 * GET /admin/rides/{rideId}/chat — the full read-only log, audited
 * (support:view). 404 = no thread (the ride was never accepted). M12: a
 * shared ride has one thread per member — `memberId` is required there
 * (400 `member_required`).
 */
export function getAdminChatLog(
  client: ApiClient,
  rideId: string,
  before?: string,
  memberId?: string,
): Promise<AdminChatLog> {
  const query = new URLSearchParams();
  if (before) {
    query.set('before', before);
  }
  if (memberId) {
    query.set('memberId', memberId);
  }
  const search = query.toString();
  const suffix = search ? `?${search}` : '';
  return client.get<AdminChatLog>(`/api/v1/admin/rides/${rideId}/chat${suffix}`);
}
