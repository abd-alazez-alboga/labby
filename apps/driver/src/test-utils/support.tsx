import { renderRouter } from "expo-router/testing-library";
import React from "react";
import { View } from "react-native";

import type { UserProfile } from "../api/auth-types";
import type {
  HelpArticle,
  HelpCategory,
  LostItemCase,
  Ticket,
  TicketCategory,
  TicketDetail,
  TicketEvent,
  TicketMessage,
} from "../api/support-types";
import { AuthProvider } from "../auth/AuthProvider";
import FeedbackRoute from "../app/feedback";
import HelpArticleRoute from "../app/help-article";
import HelpCategoryRoute from "../app/help-category";
import HelpSearchRoute from "../app/help-search";
import LostItemCaseRoute from "../app/lost-item-case";
import SupportRoute from "../app/support";
import TicketRoute from "../app/ticket";
import TicketCreateRoute from "../app/ticket-create";
import TicketsRoute from "../app/tickets";
import { SettingsScreen } from "../components/settings-screen";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { driverUser, installContractFetch, seedSession } from "./contract";
import type { ContractFetch, MockResponse } from "./contract";

/** Contract-shaped fixtures and a harness for support-v1.yaml (driver side). */

export const HELP_CATEGORIES = "GET /api/v1/help/categories";
export const TICKET_CATEGORIES = "GET /api/v1/support/ticket-categories";
export const TICKET_FILES = "POST /api/v1/ticket-files?kind=ticket_attachment";
export const CREATE_TICKET = "POST /api/v1/tickets";
export const TICKETS = "GET /api/v1/tickets?page=0&size=20";
export const TICKETS_GLANCE = "GET /api/v1/tickets?page=0&size=50";
export const LOST_ITEMS = "GET /api/v1/lost-items?page=0&size=50";
export const LOST_ITEMS_OPEN = "GET /api/v1/lost-items?open=true&page=0&size=50";
export const FEEDBACK = "POST /api/v1/feedback";
export const RECENT_TRIPS = "GET /api/v1/driver/earnings?page=0&size=5";

export const CATEGORY_RIDES = "7b000000-0000-4000-8000-000000000001";
export const CATEGORY_PAYMENTS = "7b000000-0000-4000-8000-000000000002";
export const ARTICLE_REFUND = "7a000000-0000-4000-8000-000000000001";
export const TICKET_ID = "7c000000-0000-4000-8000-000000000001";
export const LOST_TICKET_ID = "7c000000-0000-4000-8000-000000000002";
export const LOST_RIDE_ID = "11000000-0000-4000-8000-000000000001";

export function helpCategoryFixture(
  overrides: Partial<HelpCategory> = {},
): HelpCategory {
  return {
    helpCategoryId: CATEGORY_PAYMENTS,
    name: { en: "Payments & wallet", ar: "المدفوعات والمحفظة" },
    sortOrder: 0,
    articleCount: 6,
    ...overrides,
  };
}

export function helpArticleFixture(
  overrides: Partial<HelpArticle> = {},
): HelpArticle {
  return {
    helpArticleId: ARTICLE_REFUND,
    helpCategoryId: CATEGORY_PAYMENTS,
    title: {
      en: "When do I get a refund to my wallet?",
      ar: "متى تعود الأموال إلى محفظتي؟",
    },
    body: {
      en: "Refunds arrive as wallet credit.\n\nWallet credit never expires.",
      ar: "تعود الأموال إلى المحفظة كرصيد.\n\nرصيد المحفظة لا تنتهي صلاحيته.",
    },
    sortOrder: 0,
    publishedAt: "2026-10-18T10:00:00Z",
    ...overrides,
  };
}

export function ticketCategoryFixture(
  overrides: Partial<TicketCategory> = {},
): TicketCategory {
  return {
    ticketCategoryId: CATEGORY_RIDES,
    name: { en: "Payments", ar: "المدفوعات" },
    defaultPriority: "normal",
    sortOrder: 0,
    ...overrides,
  };
}

export function ticketFixture(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ticketId: TICKET_ID,
    kind: "ticket",
    category: ticketCategoryFixture(),
    priority: "normal",
    status: "waiting_on_user",
    caseStatus: null,
    description: "Charged cash after wallet payment",
    ride: null,
    attachments: [],
    unreadSupportMessages: 2,
    lastMessageAt: "2026-10-17T15:40:00Z",
    createdAt: "2026-10-17T14:02:00Z",
    updatedAt: "2026-10-17T15:41:00Z",
    ...overrides,
  };
}

export function messageFixture(
  overrides: Partial<TicketMessage> = {},
): TicketMessage {
  return {
    messageId: "7d100000-0000-4000-8000-000000000001",
    ticketId: TICKET_ID,
    senderSide: "user",
    senderName: "Sami",
    body: "I paid from my wallet but the receipt says I owe cash.",
    createdAt: "2026-10-17T14:02:30Z",
    ...overrides,
  };
}

export function eventFixture(overrides: Partial<TicketEvent> = {}): TicketEvent {
  return {
    eventId: "7d200000-0000-4000-8000-000000000001",
    type: "status_changed",
    actorSide: "support",
    actorName: null,
    fromValue: "in_progress",
    toValue: "waiting_on_user",
    createdAt: "2026-10-17T15:41:00Z",
    ...overrides,
  };
}

export function ticketDetailFixture(
  overrides: Partial<TicketDetail> = {},
): TicketDetail {
  return {
    ...ticketFixture(),
    messages: [
      messageFixture(),
      messageFixture({
        messageId: "7d100000-0000-4000-8000-000000000002",
        senderSide: "support",
        senderName: "Labby support",
        body: "Could you send a photo of the receipt screen?",
        createdAt: "2026-10-17T15:40:00Z",
      }),
    ],
    events: [
      eventFixture({
        eventId: "7d200000-0000-4000-8000-000000000000",
        type: "created",
        actorSide: "user",
        fromValue: null,
        toValue: "open",
        createdAt: "2026-10-17T14:02:00Z",
      }),
      eventFixture(),
    ],
    ...overrides,
  };
}

export function lostCaseFixture(
  overrides: Partial<LostItemCase> = {},
): LostItemCase {
  return {
    ticketId: LOST_TICKET_ID,
    caseStatus: "driver_contacted",
    status: "in_progress",
    description: "Black backpack with a laptop inside, on the back seat.",
    photos: [
      {
        fileId: "7e000000-0000-4000-8000-000000000001",
        contentType: "image/jpeg",
        sizeBytes: 2048,
        url: "https://files.test/lost-1.jpg",
      },
    ],
    ride: {
      rideId: LOST_RIDE_ID,
      kind: "standard",
      state: "completed",
      startedAt: "2026-10-18T18:24:00Z",
      counterpartName: "Rana",
    },
    reporter: {
      userId: "7f000000-0000-4000-8000-000000000001",
      name: "Rana",
      role: "rider",
    },
    driver: {
      userId: "7f000000-0000-4000-8000-000000000002",
      name: "Sami",
      role: "driver",
    },
    chatWindow: "reopened",
    createdAt: "2026-10-18T21:10:00Z",
    updatedAt: "2026-10-19T09:00:00Z",
    ...overrides,
  };
}

export const ok = (body: unknown): MockResponse => ({ status: 200, body });
export const coded = (status: number, code: string): MockResponse => ({
  status,
  body: { status, message: code, code },
});
export const emptyTicketPage = () =>
  ok({ items: [], page: 0, size: 50, totalItems: 0 });
export const emptyCasePage = () =>
  ok({ items: [], page: 0, size: 50, totalItems: 0 });

/**
 * The support screens only need auth + locale; the API is mocked at the
 * fetch boundary like every harness (test-utils/contract.ts).
 */
export async function renderSupportApp(
  routes: Record<string, MockResponse | MockResponse[]> = {},
  options: {
    language?: "en" | "ar";
    initialUrl?: string;
    user?: UserProfile;
  } = {},
): Promise<ContractFetch> {
  await seedSession(options.user ?? driverUser());
  const contract = installContractFetch(routes);
  const language = options.language ?? "en";
  renderRouter(
    {
      _layout: () => {
        const { Slot } = jest.requireActual("expo-router");
        return (
          <LocaleProvider initialLanguage={language}>
            <AuthProvider>
              <Slot />
            </AuthProvider>
          </LocaleProvider>
        );
      },
      index: () => <View testID="home-route" />,
      settings: () => <SettingsScreen />,
      support: () => <SupportRoute />,
      "help-category": () => <HelpCategoryRoute />,
      "help-article": () => <HelpArticleRoute />,
      "help-search": () => <HelpSearchRoute />,
      "ticket-create": () => <TicketCreateRoute />,
      tickets: () => <TicketsRoute />,
      ticket: () => <TicketRoute />,
      "lost-item-case": () => <LostItemCaseRoute />,
      feedback: () => <FeedbackRoute />,
      chat: () => <View testID="chat-route" />,
      notifications: () => <View testID="notifications-route" />,
    },
    { initialUrl: options.initialUrl ?? "/support" },
  );
  return contract;
}
