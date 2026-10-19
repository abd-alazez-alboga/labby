import { ApiError, authFetch } from "./client";
import type { LocalFile } from "./onboarding";
import type {
  CreateTicketRequest,
  Feedback,
  FeedbackCategory,
  HelpArticle,
  HelpArticleSummary,
  HelpCategory,
  LostItemCase,
  LostItemCasePage,
  Ticket,
  TicketCategory,
  TicketDetail,
  TicketMessage,
  TicketPage,
  UploadedTicketFile,
} from "./support-types";

/**
 * Client slice of support-v1.yaml for the driver app (UC-S-19..22,
 * UC-D-21): help center reads, tickets with their thread, the driver's
 * lost-item cases and feedback. Feedback is always submitted as `driver`
 * (T2 amendment b). Screens never call fetch themselves.
 */

// ------------------------------------------------------------- help center

/** `GET /help/categories` — categories with ≥ 1 published article, ordered. */
export function getHelpCategories(): Promise<HelpCategory[]> {
  return authFetch<HelpCategory[]>("/api/v1/help/categories");
}

/** `GET /help/categories/{id}/articles` — published summaries, ordered. */
export function getHelpArticles(
  helpCategoryId: string,
): Promise<HelpArticleSummary[]> {
  return authFetch<HelpArticleSummary[]>(
    `/api/v1/help/categories/${helpCategoryId}/articles`,
  );
}

/** `GET /help/articles/{id}` — one published article, BOTH languages. */
export function getHelpArticle(helpArticleId: string): Promise<HelpArticle> {
  return authFetch<HelpArticle>(`/api/v1/help/articles/${helpArticleId}`);
}

/**
 * `GET /help/search?q=&lang=` — case-insensitive substring match on title +
 * body of the requested language (ruling 7); q is 2..80 trimmed chars.
 */
export function searchHelp(
  q: string,
  lang: "en" | "ar",
): Promise<HelpArticleSummary[]> {
  return authFetch<HelpArticleSummary[]>(
    `/api/v1/help/search?q=${encodeURIComponent(q)}&lang=${lang}`,
  );
}

// ----------------------------------------------------------------- tickets

/** `GET /support/ticket-categories` — active, pickable categories, ordered. */
export function getTicketCategories(): Promise<TicketCategory[]> {
  return authFetch<TicketCategory[]>("/api/v1/support/ticket-categories");
}

/**
 * `POST /ticket-files?kind=ticket_attachment` (multipart `file`) — JPEG/PNG/
 * PDF; 201 | 400 type | 413 size | 429 daily cap. The fileId is usable only
 * by the uploader, once.
 */
export function uploadTicketAttachment(
  file: LocalFile,
): Promise<UploadedTicketFile> {
  const form = new FormData();
  // React Native's fetch uploads {uri,name,type} descriptors as file parts.
  form.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);
  return authFetch<UploadedTicketFile>(
    "/api/v1/ticket-files?kind=ticket_attachment",
    { method: "POST", body: form },
  );
}

/**
 * `POST /tickets` — born `open` with the category's default priority; 400
 * description/attachments, 404 category/ride, 409 `category_inactive` |
 * `category_reserved`.
 */
export function createTicket(body: CreateTicketRequest): Promise<Ticket> {
  return authFetch<Ticket>("/api/v1/tickets", { method: "POST", body });
}

/** `GET /tickets` — my tickets, both kinds, most recently updated first. */
export function getTickets(page = 0, size = 20): Promise<TicketPage> {
  return authFetch<TicketPage>(`/api/v1/tickets?page=${page}&size=${size}`);
}

/**
 * `GET /tickets/{id}` — ticket, messages and events (oldest first). Stamps
 * the read marker `user_read_at` (T2 amendment a), so a re-read of the list
 * shows the thread as read.
 */
export function getTicket(ticketId: string): Promise<TicketDetail> {
  return authFetch<TicketDetail>(`/api/v1/tickets/${ticketId}`);
}

/**
 * `POST /tickets/{id}/messages` — reply in my thread; on `waiting_on_user`
 * or `resolved` the ticket moves back to `in_progress`; 409 `ticket_closed`
 * on a closed ticket.
 */
export function postTicketMessage(
  ticketId: string,
  body: string,
): Promise<TicketMessage> {
  return authFetch<TicketMessage>(`/api/v1/tickets/${ticketId}/messages`, {
    method: "POST",
    body: { body },
  });
}

// -------------------------------------------------------------- lost items

/**
 * `GET /lost-items` — my cases; for the driver app these are the cases on
 * MY rides (UC-D-21). `open=true` keeps only non-closed cases.
 */
export function getLostItemCases(
  options: { open?: boolean; page?: number; size?: number } = {},
): Promise<LostItemCasePage> {
  const params = new URLSearchParams();
  if (options.open !== undefined) params.set("open", String(options.open));
  params.set("page", String(options.page ?? 0));
  params.set("size", String(options.size ?? 20));
  return authFetch<LostItemCasePage>(`/api/v1/lost-items?${params.toString()}`);
}

/** `GET /lost-items/{ticketId}` — one case, driver view; 404 when not a party. */
export function getLostItemCase(ticketId: string): Promise<LostItemCase> {
  return authFetch<LostItemCase>(`/api/v1/lost-items/${ticketId}`);
}

// ---------------------------------------------------------------- feedback

/**
 * `POST /feedback` — recorded, no per-item response promised (UC-S-22).
 * `submittedAs: driver` is required (T2 amendment b).
 */
export function submitFeedback(
  category: FeedbackCategory,
  body: string,
): Promise<Feedback> {
  return authFetch<Feedback>("/api/v1/feedback", {
    method: "POST",
    body: { category, body, submittedAs: "driver" },
  });
}

// ------------------------------------------------------------------ errors

/** The machine `code` of a support error body, or null. */
export function supportErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body = (error.body ?? {}) as { code?: unknown };
  return typeof body.code === "string" ? body.code : null;
}
