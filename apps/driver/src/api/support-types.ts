/**
 * Types mirroring the M14 support contract (backend/docs/api/support-v1.yaml)
 * — the DRIVER slice: the public help center (SUP-04), support tickets with
 * their thread (UC-S-19/20), lost-item cases as the ride's driver (UC-D-21)
 * and feedback (UC-S-22). Import-free so every layer can depend on them
 * without cycles.
 */

export interface LocalizedText {
  en: string;
  ar: string;
}

// ------------------------------------------------------------- help center

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

/** Contract `q` bounds — shorter is not sent, longer is 400 `query_too_long`. */
export const HELP_QUERY_MIN = 2;
export const HELP_QUERY_MAX = 80;

// ----------------------------------------------------------------- tickets

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

/** Enough to render the ride row (the apps deep-link into their ride UIs). */
export interface RideLink {
  rideId: string;
  kind: string;
  state: string;
  startedAt: string | null;
  /** The other party as seen by the ticket's user. */
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
  /** Support side: the localized "Labby support" to users. */
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

export interface CreateTicketRequest {
  categoryId: string;
  description: string;
  rideId?: string | null;
  attachmentFileIds?: string[];
}

export const TICKET_DESCRIPTION_MAX = 4000;
export const TICKET_ATTACHMENTS_MAX = 5;
export const TICKET_MESSAGE_MAX = 2000;

// -------------------------------------------------------------- lost items

export interface Party {
  userId: string;
  name: string;
  role: "rider" | "driver";
}

export interface LostItemCase {
  ticketId: string;
  caseStatus: CaseStatus;
  status: TicketStatus;
  description: string;
  photos: Attachment[];
  ride: RideLink;
  reporter: Party;
  driver: Party;
  /** comms-v1 window state of the REPORTER's thread with the driver. */
  chatWindow: "open" | "read_only" | "reopened";
  createdAt: string;
  updatedAt: string;
}

export interface LostItemCasePage {
  items: LostItemCase[];
  page: number;
  size: number;
  totalItems: number;
}

// ---------------------------------------------------------------- feedback

/** Fixed catalog (owner ruling 5) — named in app i18n, never admin-managed. */
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

export const FEEDBACK_BODY_MAX = 2000;
