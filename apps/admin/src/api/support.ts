import type { ApiClient } from './client';

/**
 * Contract types and calls for the M14 support & content admin endpoints.
 * Source of truth: backend/docs/api/support-v1.yaml — the ticket queue and
 * thread (UC-A-21, `support:view` / `support:handle`), lost-item cases
 * (UC-A-22), ticket categories (UC-A-24) and the help CMS (UC-A-23, both
 * behind `content:view` / `content:manage`), and feedback (UC-A-25).
 */

export type TicketKind = 'ticket' | 'lost_item';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketStatus = 'open' | 'in_progress' | 'waiting_on_user' | 'resolved' | 'closed';
export type CaseStatus =
  'reported' | 'driver_contacted' | 'found' | 'not_found' | 'returned' | 'closed';
export type ArticleStatus = 'draft' | 'published';
export type FeedbackCategory =
  'app_experience' | 'pricing' | 'drivers' | 'safety' | 'feature_request' | 'other';

export const TICKET_PRIORITIES: readonly TicketPriority[] = ['urgent', 'high', 'normal', 'low'];
export const TICKET_STATUSES: readonly TicketStatus[] = [
  'open',
  'in_progress',
  'waiting_on_user',
  'resolved',
  'closed',
];
export const CASE_STATUSES: readonly CaseStatus[] = [
  'reported',
  'driver_contacted',
  'found',
  'not_found',
  'returned',
  'closed',
];
export const FEEDBACK_CATEGORIES: readonly FeedbackCategory[] = [
  'app_experience',
  'pricing',
  'drivers',
  'safety',
  'feature_request',
  'other',
];

/**
 * The header's ticket state machine (SUP-02): the admin transitions allowed
 * FROM each status. `closed` is terminal; lost-item tickets move through the
 * case instead (`use_case_status`).
 */
export const TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ['in_progress'],
  in_progress: ['waiting_on_user', 'resolved'],
  waiting_on_user: ['in_progress'],
  resolved: ['in_progress', 'closed'],
  closed: [],
};

/** The LOST-02 case machine: forward moves allowed FROM each case status. */
export const CASE_TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  reported: ['driver_contacted'],
  driver_contacted: ['found', 'not_found'],
  found: ['returned'],
  not_found: ['closed'],
  returned: ['closed'],
  closed: [],
};

export interface LocalizedText {
  en: string;
  ar: string;
}

export interface Party {
  userId: string;
  name: string;
  role: 'rider' | 'driver';
}

export interface Attachment {
  fileId: string;
  contentType: string;
  sizeBytes: number;
  /** Signed private URL (onboarding-v1 /files/{token}). */
  url: string;
}

export interface RideLink {
  rideId: string;
  kind: string;
  state: string;
  startedAt: string | null;
  /** The other party as seen by the ticket's user. */
  counterpartName: string;
}

export interface TicketCategoryRef {
  ticketCategoryId: string;
  name: LocalizedText;
  defaultPriority: TicketPriority;
  sortOrder: number;
}

export interface TicketMessage {
  messageId: string;
  ticketId: string;
  senderSide: 'user' | 'support';
  senderName: string;
  body: string;
  createdAt: string;
}

export interface TicketEvent {
  eventId: string;
  type:
    | 'created'
    | 'status_changed'
    | 'priority_changed'
    | 'assigned'
    | 'case_status_changed'
    | 'reminder_sent';
  actorSide: 'user' | 'support' | 'system';
  actorName?: string | null;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}

export interface AdminTicket {
  ticketId: string;
  kind: TicketKind;
  category: TicketCategoryRef;
  priority: TicketPriority;
  status: TicketStatus;
  caseStatus: CaseStatus | null;
  description: string;
  ride: RideLink | null;
  attachments: Attachment[];
  unreadSupportMessages: number;
  lastMessageAt?: string | null;
  createdAt: string;
  updatedAt: string;
  user: Party;
  openedBy: { userId: string; name: string; side: 'user' | 'support' };
  assignee: { userId: string; name: string } | null;
  sosEventId: string | null;
  waitingSince: string | null;
  reminderSentAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  /** Since creation — the queue's age column. */
  ageSeconds: number;
}

export interface AdminTicketPage {
  items: AdminTicket[];
  page: number;
  size: number;
  totalItems: number;
}

export interface AdminTicketDetail extends AdminTicket {
  messages: TicketMessage[];
  events: TicketEvent[];
  /** Served only to `support:handle` holders; null otherwise. */
  userPhone: string | null;
  /** Lost-item tickets: the driver and the reopened chat the handler can read. */
  lostItem: { driver: Party; chatWindow: 'open' | 'read_only' | 'reopened' } | null;
}

export interface AdminTicketQuery {
  kind?: TicketKind;
  /** May repeat; passing it replaces the default non-closed filter. */
  status?: readonly TicketStatus[];
  priority?: TicketPriority;
  categoryId?: string;
  assigneeUserId?: string;
  unassigned?: boolean;
  userId?: string;
  rideId?: string;
  page?: number;
  size?: number;
}

/** GET /admin/tickets — priority then age (SUP-03); support:view. */
export function listAdminTickets(
  client: ApiClient,
  query: AdminTicketQuery = {},
): Promise<AdminTicketPage> {
  const params = new URLSearchParams();
  for (const status of query.status ?? []) {
    params.append('status', status);
  }
  for (const key of [
    'kind',
    'priority',
    'categoryId',
    'assigneeUserId',
    'userId',
    'rideId',
  ] as const) {
    const value = query[key];
    if (value) {
      params.set(key, value);
    }
  }
  if (query.unassigned !== undefined) {
    params.set('unassigned', String(query.unassigned));
  }
  if (query.page !== undefined) {
    params.set('page', String(query.page));
  }
  if (query.size !== undefined) {
    params.set('size', String(query.size));
  }
  const search = params.toString();
  return client.get<AdminTicketPage>(`/api/v1/admin/tickets${search ? `?${search}` : ''}`);
}

/** GET /admin/tickets/{id} — thread, history, attachments; support:view. */
export function getAdminTicket(client: ApiClient, ticketId: string): Promise<AdminTicketDetail> {
  return client.get<AdminTicketDetail>(`/api/v1/admin/tickets/${ticketId}`);
}

/** POST /admin/tickets/{id}/messages — support:handle; 409 `ticket_closed`. */
export function postAdminTicketMessage(
  client: ApiClient,
  ticketId: string,
  body: string,
): Promise<TicketMessage> {
  return client.post<TicketMessage>(`/api/v1/admin/tickets/${ticketId}/messages`, { body });
}

/** POST /admin/tickets/{id}/status — support:handle; 409 `invalid_transition` / `use_case_status`. */
export function setTicketStatus(
  client: ApiClient,
  ticketId: string,
  status: TicketStatus,
): Promise<AdminTicket> {
  return client.post<AdminTicket>(`/api/v1/admin/tickets/${ticketId}/status`, { status });
}

/** POST /admin/tickets/{id}/priority — support:handle; 409 `ticket_closed`. */
export function setTicketPriority(
  client: ApiClient,
  ticketId: string,
  priority: TicketPriority,
): Promise<AdminTicket> {
  return client.post<AdminTicket>(`/api/v1/admin/tickets/${ticketId}/priority`, { priority });
}

/** POST /admin/tickets/{id}/assignee — null unassigns; 422 `assignee_not_handler`. */
export function setTicketAssignee(
  client: ApiClient,
  ticketId: string,
  assigneeUserId: string | null,
): Promise<AdminTicket> {
  return client.post<AdminTicket>(`/api/v1/admin/tickets/${ticketId}/assignee`, {
    assigneeUserId,
  });
}

/* ---------- Lost items (UC-A-22) ---------- */

export interface LostItemQuery {
  /** Default = every non-closed case. */
  caseStatus?: readonly CaseStatus[];
  page?: number;
  size?: number;
}

/** GET /admin/lost-items — the lost-item slice of the queue; support:view. */
export function listAdminLostItems(
  client: ApiClient,
  query: LostItemQuery = {},
): Promise<AdminTicketPage> {
  const params = new URLSearchParams();
  for (const status of query.caseStatus ?? []) {
    params.append('caseStatus', status);
  }
  if (query.page !== undefined) {
    params.set('page', String(query.page));
  }
  if (query.size !== undefined) {
    params.set('size', String(query.size));
  }
  const search = params.toString();
  return client.get<AdminTicketPage>(`/api/v1/admin/lost-items${search ? `?${search}` : ''}`);
}

/** POST /admin/lost-items/{id}/case-status — support:handle; 409 `invalid_transition`. */
export function setCaseStatus(
  client: ApiClient,
  ticketId: string,
  caseStatus: CaseStatus,
): Promise<AdminTicket> {
  return client.post<AdminTicket>(`/api/v1/admin/lost-items/${ticketId}/case-status`, {
    caseStatus,
  });
}

/* ---------- Ticket categories (UC-A-24, content:view/manage) ---------- */

export interface AdminTicketCategory {
  ticketCategoryId: string;
  /** `lost_item` on the protected system row. */
  systemCode: string | null;
  nameEn: string;
  nameAr: string;
  defaultPriority: TicketPriority;
  sortOrder: number;
  active: boolean;
  /** Tickets referencing it (delete is refused above 0). */
  ticketCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveTicketCategoryRequest {
  nameEn: string;
  nameAr: string;
  defaultPriority: TicketPriority;
  sortOrder?: number;
}

export interface PatchTicketCategoryRequest {
  nameEn?: string;
  nameAr?: string;
  defaultPriority?: TicketPriority;
  sortOrder?: number;
  active?: boolean;
}

/** GET /admin/ticket-categories — all, incl. inactive + system; content:view. */
export function listAdminTicketCategories(client: ApiClient): Promise<AdminTicketCategory[]> {
  return client.get<AdminTicketCategory[]>('/api/v1/admin/ticket-categories');
}

/** POST /admin/ticket-categories — content:manage; 422 = blank name. */
export function createTicketCategory(
  client: ApiClient,
  body: SaveTicketCategoryRequest,
): Promise<AdminTicketCategory> {
  return client.post<AdminTicketCategory>('/api/v1/admin/ticket-categories', body);
}

/** PATCH /admin/ticket-categories/{id} — content:manage; 409 `system_category`. */
export function patchTicketCategory(
  client: ApiClient,
  ticketCategoryId: string,
  body: PatchTicketCategoryRequest,
): Promise<AdminTicketCategory> {
  return client.patch<AdminTicketCategory>(
    `/api/v1/admin/ticket-categories/${ticketCategoryId}`,
    body,
  );
}

/* ---------- Help CMS (UC-A-23, content:view/manage) ---------- */

export interface AdminHelpCategory {
  helpCategoryId: string;
  nameEn: string;
  nameAr: string;
  sortOrder: number;
  /** All articles. */
  articleCount: number;
  publishedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminHelpArticle {
  helpArticleId: string;
  helpCategoryId: string;
  titleEn: string | null;
  titleAr: string | null;
  bodyEn: string | null;
  bodyAr: string | null;
  sortOrder: number;
  status: ArticleStatus;
  publishedAt: string | null;
  /** The blank fields that block publishing (empty when publishable). */
  missing: ('titleEn' | 'titleAr' | 'bodyEn' | 'bodyAr')[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveHelpArticleRequest {
  helpCategoryId: string;
  titleEn?: string | null;
  titleAr?: string | null;
  bodyEn?: string | null;
  bodyAr?: string | null;
}

/** GET /admin/help/categories — with article counts; content:view. */
export function listAdminHelpCategories(client: ApiClient): Promise<AdminHelpCategory[]> {
  return client.get<AdminHelpCategory[]>('/api/v1/admin/help/categories');
}

/** POST /admin/help/categories — appended last; content:manage. */
export function createHelpCategory(
  client: ApiClient,
  body: { nameEn: string; nameAr: string },
): Promise<AdminHelpCategory> {
  return client.post<AdminHelpCategory>('/api/v1/admin/help/categories', body);
}

/** PATCH /admin/help/categories/{id} — rename; content:manage. */
export function renameHelpCategory(
  client: ApiClient,
  helpCategoryId: string,
  body: { nameEn: string; nameAr: string },
): Promise<AdminHelpCategory> {
  return client.patch<AdminHelpCategory>(`/api/v1/admin/help/categories/${helpCategoryId}`, body);
}

/** PUT /admin/help/categories/order — the complete new order; 422 `order_incomplete`. */
export function reorderHelpCategories(client: ApiClient, ids: readonly string[]): Promise<void> {
  return client.put<void>('/api/v1/admin/help/categories/order', { ids });
}

/** GET /admin/help/articles — drafts included; content:view. */
export function listAdminHelpArticles(
  client: ApiClient,
  query: { categoryId?: string; status?: ArticleStatus } = {},
): Promise<AdminHelpArticle[]> {
  const params = new URLSearchParams();
  if (query.categoryId) {
    params.set('categoryId', query.categoryId);
  }
  if (query.status) {
    params.set('status', query.status);
  }
  const search = params.toString();
  return client.get<AdminHelpArticle[]>(`/api/v1/admin/help/articles${search ? `?${search}` : ''}`);
}

/** GET /admin/help/articles/{id} — any status; content:view. */
export function getAdminHelpArticle(
  client: ApiClient,
  helpArticleId: string,
): Promise<AdminHelpArticle> {
  return client.get<AdminHelpArticle>(`/api/v1/admin/help/articles/${helpArticleId}`);
}

/** POST /admin/help/articles — a draft needs a title in one language; content:manage. */
export function createHelpArticle(
  client: ApiClient,
  body: SaveHelpArticleRequest,
): Promise<AdminHelpArticle> {
  return client.post<AdminHelpArticle>('/api/v1/admin/help/articles', body);
}

/** PATCH /admin/help/articles/{id} — 422 `translation_missing` when blanking a published text. */
export function patchHelpArticle(
  client: ApiClient,
  helpArticleId: string,
  body: SaveHelpArticleRequest,
): Promise<AdminHelpArticle> {
  return client.patch<AdminHelpArticle>(`/api/v1/admin/help/articles/${helpArticleId}`, body);
}

/** POST /admin/help/articles/{id}/publish — 422 `translation_missing`; content:manage. */
export function publishHelpArticle(
  client: ApiClient,
  helpArticleId: string,
): Promise<AdminHelpArticle> {
  return client.post<AdminHelpArticle>(`/api/v1/admin/help/articles/${helpArticleId}/publish`);
}

/** POST /admin/help/articles/{id}/unpublish — back to draft; content:manage. */
export function unpublishHelpArticle(
  client: ApiClient,
  helpArticleId: string,
): Promise<AdminHelpArticle> {
  return client.post<AdminHelpArticle>(`/api/v1/admin/help/articles/${helpArticleId}/unpublish`);
}

/** PUT /admin/help/categories/{id}/articles/order — 422 `order_incomplete`. */
export function reorderHelpArticles(
  client: ApiClient,
  helpCategoryId: string,
  ids: readonly string[],
): Promise<void> {
  return client.put<void>(`/api/v1/admin/help/categories/${helpCategoryId}/articles/order`, {
    ids,
  });
}

/* ---------- Feedback (UC-A-25) ---------- */

export interface AdminFeedback {
  feedbackId: string;
  category: FeedbackCategory;
  body: string;
  submittedAs: 'rider' | 'driver';
  createdAt: string;
  user: Party;
  tags: string[];
}

export interface AdminFeedbackPage {
  items: AdminFeedback[];
  page: number;
  size: number;
  totalItems: number;
}

export interface FeedbackQuery {
  category?: FeedbackCategory;
  tag?: string;
  submittedAs?: 'rider' | 'driver';
  from?: string;
  /** Exclusive. */
  to?: string;
  page?: number;
  size?: number;
}

/** GET /admin/feedback — newest first; support:view. */
export function listAdminFeedback(
  client: ApiClient,
  query: FeedbackQuery = {},
): Promise<AdminFeedbackPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return client.get<AdminFeedbackPage>(`/api/v1/admin/feedback${search ? `?${search}` : ''}`);
}

export interface FeedbackStats {
  from: string;
  to: string;
  bucket: 'day' | 'week' | 'month';
  total: number;
  /** Every catalog category present, zero included. */
  byCategory: Record<string, number>;
  buckets: { start: string; total: number; byCategory: Record<string, number> }[];
}

/** GET /admin/feedback/stats — counts per bucket; support:view. */
export function getFeedbackStats(
  client: ApiClient,
  query: {
    from: string;
    to: string;
    bucket?: 'day' | 'week' | 'month';
    submittedAs?: 'rider' | 'driver';
  },
): Promise<FeedbackStats> {
  const params = new URLSearchParams();
  params.set('from', query.from);
  params.set('to', query.to);
  if (query.bucket) {
    params.set('bucket', query.bucket);
  }
  if (query.submittedAs) {
    params.set('submittedAs', query.submittedAs);
  }
  return client.get<FeedbackStats>(`/api/v1/admin/feedback/stats?${params.toString()}`);
}

/** PUT /admin/feedback/{id}/tags — replaces the set; support:handle; 422 `tag_invalid`. */
export function setFeedbackTags(
  client: ApiClient,
  feedbackId: string,
  tags: readonly string[],
): Promise<AdminFeedback> {
  return client.put<AdminFeedback>(`/api/v1/admin/feedback/${feedbackId}/tags`, { tags });
}
