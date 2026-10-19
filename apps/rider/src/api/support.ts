import { apiFetch } from "./http-client";

/**
 * Client slice of the M14 support contract for the rider app
 * (backend/docs/api/support-v1.yaml): the public help center (SUP-04),
 * support tickets with their thread (UC-S-19/20), lost-item cases
 * (UC-R-20) and feedback (UC-S-22). Types mirror the contract schemas
 * 1:1; screens never call fetch themselves. The rider always submits
 * feedback as `rider`.
 */

// --------------------------------------------------------------- schemas

export interface LocalizedText {
  en: string;
  ar: string;
}

export interface HelpCategory {
  helpCategoryId: string;
  name: LocalizedText;
  sortOrder: number;
  /** Published articles. */
  articleCount: number;
}

export interface HelpArticleSummary {
  helpArticleId: string;
  helpCategoryId: string;
  title: LocalizedText;
  sortOrder: number;
}

export interface HelpArticle extends HelpArticleSummary {
  /** Plain text; paragraphs separated by blank lines. */
  body: LocalizedText;
  publishedAt: string;
}

export type TicketKind = "ticket" | "lost_item";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export const TICKET_STATUSES = [
  "open",
  "in_progress",
  "waiting_on_user",
  "resolved",
  "closed",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const CASE_STATUSES = [
  "reported",
  "driver_contacted",
  "found",
  "not_found",
  "returned",
  "closed",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export interface TicketCategory {
  ticketCategoryId: string;
  name: LocalizedText;
  defaultPriority: TicketPriority;
  sortOrder: number;
}

export interface UploadedTicketFile {
  fileId: string;
  kind: "ticket_attachment" | "lost_item_photo";
  contentType: string;
  sizeBytes: number;
}

export interface Attachment {
  fileId: string;
  contentType: string;
  sizeBytes: number;
  /** Signed private URL. */
  url: string;
}

/** Enough to render the ride row; screens deep-link into ride history. */
export interface RideLink {
  rideId: string;
  kind: string;
  state: string;
  startedAt: string | null;
  /** The other party as seen by the ticket's user (first name). */
  counterpartName: string;
}

export interface Ticket {
  ticketId: string;
  kind: TicketKind;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  /** Lost-item tickets only. */
  caseStatus: CaseStatus | null;
  description: string;
  ride: RideLink | null;
  attachments: Attachment[];
  /** Support messages newer than the user's last read of the thread. */
  unreadSupportMessages: number;
  lastMessageAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketPage {
  items: Ticket[];
  page: number;
  size: number;
  totalItems: number;
}

export interface TicketMessage {
  messageId: string;
  ticketId: string;
  senderSide: "user" | "support";
  senderName: string;
  body: string;
  createdAt: string;
}

export type TicketEventType =
  | "created"
  | "status_changed"
  | "priority_changed"
  | "assigned"
  | "case_status_changed"
  | "reminder_sent";

export interface TicketEvent {
  eventId: string;
  type: TicketEventType;
  actorSide: "user" | "support" | "system";
  actorName?: string | null;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}

export interface TicketDetail extends Ticket {
  /** Oldest first. */
  messages: TicketMessage[];
  /** Oldest first. */
  events: TicketEvent[];
}

export interface Party {
  userId: string;
  name: string;
  role: "rider" | "driver";
}

export type ChatWindow = "open" | "read_only" | "reopened";

export interface LostItemCase {
  ticketId: string;
  caseStatus: CaseStatus;
  status: TicketStatus;
  description: string;
  photos: Attachment[];
  ride: RideLink;
  reporter: Party;
  driver: Party;
  /** comms-v1 window state of the reporter's thread. */
  chatWindow: ChatWindow;
  createdAt: string;
  updatedAt: string;
}

export interface LostItemCasePage {
  items: LostItemCase[];
  page: number;
  size: number;
  totalItems: number;
}

export const FEEDBACK_CATEGORIES = [
  "app_experience",
  "pricing",
  "drivers",
  "safety",
  "feature_request",
  "other",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export interface Feedback {
  feedbackId: string;
  category: FeedbackCategory;
  body: string;
  submittedAs: "rider" | "driver";
  createdAt: string;
}

export const TICKET_DESCRIPTION_MAX = 4000;
export const TICKET_MESSAGE_MAX = 2000;
export const TICKET_ATTACHMENTS_MAX = 5;
export const LOST_ITEM_PHOTOS_MAX = 3;
export const FEEDBACK_BODY_MAX = 2000;
export const HELP_SEARCH_MIN = 2;
export const HELP_SEARCH_MAX = 80;

/** A React Native multipart file descriptor. */
export interface TicketFile {
  uri: string;
  name: string;
  type: string;
}

// --------------------------------------------------------------- help

/** `GET /help/categories` — categories with published articles, in order. */
export function listHelpCategories(): Promise<HelpCategory[]> {
  return apiFetch<HelpCategory[]>("/api/v1/help/categories", { auth: true });
}

/** `GET /help/categories/{id}/articles` — published articles, in order. */
export function listHelpArticles(
  helpCategoryId: string,
): Promise<HelpArticleSummary[]> {
  return apiFetch<HelpArticleSummary[]>(
    `/api/v1/help/categories/${encodeURIComponent(helpCategoryId)}/articles`,
    { auth: true },
  );
}

/** `GET /help/articles/{id}` — one published article, both languages. */
export function getHelpArticle(helpArticleId: string): Promise<HelpArticle> {
  return apiFetch<HelpArticle>(
    `/api/v1/help/articles/${encodeURIComponent(helpArticleId)}`,
    { auth: true },
  );
}

/** `GET /help/search?q=&lang=` — title matches first, then body matches. */
export function searchHelp(
  q: string,
  lang: "en" | "ar",
): Promise<HelpArticleSummary[]> {
  return apiFetch<HelpArticleSummary[]>(
    `/api/v1/help/search?q=${encodeURIComponent(q)}&lang=${lang}`,
    { auth: true },
  );
}

// --------------------------------------------------------------- tickets

/** `GET /support/ticket-categories` — pickable categories (no system row). */
export function listTicketCategories(): Promise<TicketCategory[]> {
  return apiFetch<TicketCategory[]>("/api/v1/support/ticket-categories", {
    auth: true,
  });
}

/** `POST /ticket-files?kind=` — one attachment / photo, multipart. */
export function uploadTicketFile(
  file: TicketFile,
  kind: "ticket_attachment" | "lost_item_photo",
): Promise<UploadedTicketFile> {
  const form = new FormData();
  // React Native's FormData accepts a {uri, name, type} file descriptor.
  form.append("file", file as unknown as Blob);
  return apiFetch<UploadedTicketFile>(`/api/v1/ticket-files?kind=${kind}`, {
    method: "POST",
    auth: true,
    body: form,
  });
}

export interface CreateTicketRequest {
  categoryId: string;
  description: string;
  rideId?: string | null;
  attachmentFileIds?: string[];
}

/**
 * `POST /tickets` — born `open`; 409 `category_inactive`. `submittedAs: rider` is required
 * (T5 amendment f).
 */
export function createTicket(request: CreateTicketRequest): Promise<Ticket> {
  return apiFetch<Ticket>("/api/v1/tickets", {
    method: "POST",
    auth: true,
    body: JSON.stringify({ ...request, submittedAs: "rider" }),
  });
}

export const TICKETS_PAGE_SIZE = 20;

/** `GET /tickets` — my tickets, most recently updated first. */
export function listMyTickets(page = 0): Promise<TicketPage> {
  return apiFetch<TicketPage>(
    `/api/v1/tickets?page=${page}&size=${TICKETS_PAGE_SIZE}`,
    { auth: true },
  );
}

/** `GET /tickets/{id}` — thread + history; stamps the read marker. */
export function getTicket(ticketId: string): Promise<TicketDetail> {
  return apiFetch<TicketDetail>(
    `/api/v1/tickets/${encodeURIComponent(ticketId)}`,
    { auth: true },
  );
}

/** `POST /tickets/{id}/messages` — 409 `ticket_closed` when read-only. */
export function postTicketMessage(
  ticketId: string,
  body: string,
): Promise<TicketMessage> {
  return apiFetch<TicketMessage>(
    `/api/v1/tickets/${encodeURIComponent(ticketId)}/messages`,
    { method: "POST", auth: true, body: JSON.stringify({ body }) },
  );
}

// --------------------------------------------------------------- lost items

export interface LostItemReportRequest {
  description: string;
  photoFileIds?: string[];
}

/**
 * `POST /rides/{rideId}/lost-item` — opens the case and reopens the chat.
 * 409 `ride_not_completed` / `lost_item_case_open`.
 */
export function reportLostItem(
  rideId: string,
  request: LostItemReportRequest,
): Promise<LostItemCase> {
  return apiFetch<LostItemCase>(
    `/api/v1/rides/${encodeURIComponent(rideId)}/lost-item`,
    { method: "POST", auth: true, body: JSON.stringify(request) },
  );
}

/** `GET /lost-items/{ticketId}` — one case, rider or driver view. */
export function getLostItemCase(ticketId: string): Promise<LostItemCase> {
  return apiFetch<LostItemCase>(
    `/api/v1/lost-items/${encodeURIComponent(ticketId)}`,
    { auth: true },
  );
}

// --------------------------------------------------------------- feedback

/** `POST /feedback` — recorded; no per-item response is promised. */
export function submitFeedback(
  category: FeedbackCategory,
  body: string,
): Promise<Feedback> {
  return apiFetch<Feedback>("/api/v1/feedback", {
    method: "POST",
    auth: true,
    body: JSON.stringify({ category, body, submittedAs: "rider" }),
  });
}

// --------------------------------------------------------------- helpers

/** The localized side of a contract `LocalizedText`. */
export function localized(text: LocalizedText, locale: "en" | "ar"): string {
  return locale === "ar" ? text.ar : text.en;
}
