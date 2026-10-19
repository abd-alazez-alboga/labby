import type { UserProfile } from '../api/auth';
import type {
  AdminFeedback,
  AdminFeedbackPage,
  AdminHelpArticle,
  AdminHelpCategory,
  AdminTicket,
  AdminTicketCategory,
  AdminTicketDetail,
  AdminTicketPage,
  FeedbackStats,
  TicketEvent,
  TicketMessage,
} from '../api/support';
import { adminUser, jsonResponse, stubFetchRoutes, type FetchRouteHandler } from './test-utils';

/**
 * Shared M14 support fixtures, shaped exactly like support-v1.yaml's schemas
 * (AdminTicket, AdminHelpArticle, AdminFeedback…). Names follow the approved
 * A14 artboards (Omar T., Rana K., Samir A.…).
 */

/** Support seat: queues + handling + the evidence/remedy permissions. */
export const SUPPORT_ADMIN = adminUser([
  'support:view',
  'support:handle',
  'rides:view',
  'wallets:view',
  'wallets:manage',
]);
/** May read the queues but not reply, triage or progress cases. */
export const SUPPORT_VIEWER = adminUser(['support:view']);
/** Content seat: help CMS + ticket categories, read-write. */
export const CONTENT_ADMIN = adminUser(['content:view', 'content:manage', 'support:view']);
/** Content read-only. */
export const CONTENT_VIEWER = adminUser(['content:view']);
/** No support/content permission at all. */
export const OUTSIDER = adminUser(['users:view']);

export const TICKET_1 = 'aaaa0000-0000-4000-8000-000000000001';
export const TICKET_2 = 'aaaa0000-0000-4000-8000-000000000002';
export const LOST_TICKET = 'aaaa0000-0000-4000-8000-000000000003';
export const RIDE_1 = 'bbbb0000-0000-4000-8000-000000000001';
export const OMAR_ID = 'cccc0000-0000-4000-8000-000000000001';
export const RANA_ID = 'cccc0000-0000-4000-8000-000000000002';
export const SAMIR_ID = 'cccc0000-0000-4000-8000-000000000003';
export const CATEGORY_PAYMENTS = 'dddd0000-0000-4000-8000-000000000001';
export const CATEGORY_LOST = 'dddd0000-0000-4000-8000-000000000002';
export const HELP_CAT_1 = 'eeee0000-0000-4000-8000-000000000001';
export const HELP_CAT_2 = 'eeee0000-0000-4000-8000-000000000002';
export const ARTICLE_1 = 'ffff0000-0000-4000-8000-000000000001';
export const FEEDBACK_1 = 'abab0000-0000-4000-8000-000000000001';

export function adminTicket(overrides: Partial<AdminTicket> = {}): AdminTicket {
  return {
    ticketId: TICKET_1,
    kind: 'ticket',
    category: {
      ticketCategoryId: CATEGORY_PAYMENTS,
      name: { en: 'Payments', ar: 'المدفوعات' },
      defaultPriority: 'high',
      sortOrder: 0,
    },
    priority: 'high',
    status: 'waiting_on_user',
    caseStatus: null,
    description: 'Charged cash after wallet payment',
    ride: {
      rideId: RIDE_1,
      kind: 'standard',
      state: 'completed',
      startedAt: '2026-10-17T11:00:00Z',
      counterpartName: 'Sami B.',
    },
    attachments: [],
    unreadSupportMessages: 0,
    lastMessageAt: '2026-10-17T12:40:00Z',
    createdAt: '2026-10-17T11:02:00Z',
    updatedAt: '2026-10-17T12:41:00Z',
    user: { userId: OMAR_ID, name: 'Omar T.', role: 'rider' },
    openedBy: { userId: OMAR_ID, name: 'Omar T.', side: 'user' },
    assignee: { userId: SAMIR_ID, name: 'Samir A.' },
    sosEventId: null,
    waitingSince: '2026-10-17T12:41:00Z',
    reminderSentAt: null,
    resolvedAt: null,
    closedAt: null,
    ageSeconds: 4 * 3600,
    ...overrides,
  };
}

export function ticketPage(items: AdminTicket[], totalItems = items.length): AdminTicketPage {
  return { items, page: 0, size: 20, totalItems };
}

export function ticketMessage(overrides: Partial<TicketMessage> = {}): TicketMessage {
  return {
    messageId: 'm1',
    ticketId: TICKET_1,
    senderSide: 'user',
    senderName: 'Omar T.',
    body: 'I paid from my wallet but the receipt also says I owe cash.',
    createdAt: '2026-10-17T11:02:00Z',
    ...overrides,
  };
}

export function ticketEvent(overrides: Partial<TicketEvent> = {}): TicketEvent {
  return {
    eventId: 'e1',
    type: 'status_changed',
    actorSide: 'support',
    actorName: 'Samir A.',
    fromValue: 'in_progress',
    toValue: 'waiting_on_user',
    createdAt: '2026-10-17T12:41:00Z',
    ...overrides,
  };
}

export function adminTicketDetail(overrides: Partial<AdminTicketDetail> = {}): AdminTicketDetail {
  return {
    ...adminTicket(),
    messages: [
      ticketMessage(),
      ticketMessage({
        messageId: 'm2',
        senderSide: 'support',
        senderName: 'Samir A.',
        body: 'Could you send a photo of the receipt screen?',
        createdAt: '2026-10-17T12:40:00Z',
      }),
    ],
    events: [ticketEvent()],
    userPhone: '+963933000111',
    lostItem: null,
    ...overrides,
  };
}

export function lostItemDetail(overrides: Partial<AdminTicketDetail> = {}): AdminTicketDetail {
  return adminTicketDetail({
    ticketId: LOST_TICKET,
    kind: 'lost_item',
    caseStatus: 'driver_contacted',
    status: 'in_progress',
    description: 'Black backpack, laptop inside',
    category: {
      ticketCategoryId: CATEGORY_LOST,
      name: { en: 'Lost item', ar: 'مفقودات' },
      defaultPriority: 'high',
      sortOrder: 99,
    },
    user: { userId: RANA_ID, name: 'Rana K.', role: 'rider' },
    openedBy: { userId: RANA_ID, name: 'Rana K.', side: 'user' },
    waitingSince: null,
    messages: [],
    events: [
      ticketEvent({
        eventId: 'e-case',
        type: 'case_status_changed',
        fromValue: 'reported',
        toValue: 'driver_contacted',
        createdAt: '2026-10-19T09:30:00Z',
      }),
    ],
    lostItem: {
      driver: { userId: SAMIR_ID, name: 'Sami B.', role: 'driver' },
      chatWindow: 'reopened',
      memberId: null,
    },
    ...overrides,
  });
}

export function ticketCategory(overrides: Partial<AdminTicketCategory> = {}): AdminTicketCategory {
  return {
    ticketCategoryId: CATEGORY_PAYMENTS,
    systemCode: null,
    nameEn: 'Payments',
    nameAr: 'المدفوعات',
    defaultPriority: 'high',
    sortOrder: 0,
    active: true,
    ticketCount: 7,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

export const SYSTEM_CATEGORY = ticketCategory({
  ticketCategoryId: CATEGORY_LOST,
  systemCode: 'lost_item',
  nameEn: 'Lost item',
  nameAr: 'مفقودات',
  defaultPriority: 'high',
  sortOrder: 99,
  ticketCount: 4,
});

export function helpCategory(overrides: Partial<AdminHelpCategory> = {}): AdminHelpCategory {
  return {
    helpCategoryId: HELP_CAT_1,
    nameEn: 'Payments & wallet',
    nameAr: 'المدفوعات والمحفظة',
    sortOrder: 0,
    articleCount: 3,
    publishedCount: 2,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-12T00:00:00Z',
    ...overrides,
  };
}

export function helpArticle(overrides: Partial<AdminHelpArticle> = {}): AdminHelpArticle {
  return {
    helpArticleId: ARTICLE_1,
    helpCategoryId: HELP_CAT_1,
    titleEn: 'How do I pay for a ride?',
    titleAr: 'كيف أدفع أجرة الرحلة؟',
    bodyEn: 'You can pay with cash or your wallet.',
    bodyAr: 'يمكنك الدفع نقدًا أو من محفظتك.',
    sortOrder: 0,
    status: 'published',
    publishedAt: '2026-10-12T00:00:00Z',
    missing: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-12T00:00:00Z',
    ...overrides,
  };
}

export function feedbackEntry(overrides: Partial<AdminFeedback> = {}): AdminFeedback {
  return {
    feedbackId: FEEDBACK_1,
    category: 'app_experience',
    body: 'It would be great if the app remembered my last destinations.',
    submittedAs: 'rider',
    createdAt: '2026-10-19T10:00:00Z',
    user: { userId: OMAR_ID, name: 'Omar T.', role: 'rider' },
    tags: ['saved-places'],
    ...overrides,
  };
}

export function feedbackPage(items: AdminFeedback[], totalItems = items.length): AdminFeedbackPage {
  return { items, page: 0, size: 20, totalItems };
}

export function feedbackStats(overrides: Partial<FeedbackStats> = {}): FeedbackStats {
  const zero = {
    app_experience: 0,
    pricing: 0,
    drivers: 0,
    safety: 0,
    feature_request: 0,
    other: 0,
  };
  return {
    from: '2026-09-28T00:00:00Z',
    to: '2026-10-26T00:00:00Z',
    bucket: 'week',
    total: 30,
    byCategory: { ...zero, app_experience: 21, pricing: 9 },
    buckets: [
      { start: '2026-09-28T00:00:00Z', total: 9, byCategory: { ...zero, app_experience: 9 } },
      {
        start: '2026-10-05T00:00:00Z',
        total: 14,
        byCategory: { ...zero, app_experience: 5, pricing: 9 },
      },
      { start: '2026-10-12T00:00:00Z', total: 7, byCategory: { ...zero, app_experience: 7 } },
      { start: '2026-10-19T00:00:00Z', total: 0, byCategory: zero },
    ],
    ...overrides,
  };
}

/**
 * Stubs /users/me plus empty answers for every background surface the shell
 * fires (queue badges, SOS polling); `extra` handles the test's own routes.
 */
export function stubSupportRoutes(user: UserProfile, extra: FetchRouteHandler = () => null) {
  return stubFetchRoutes((method, path, init, url) => {
    const handled = extra(method, path, init, url);
    if (handled) {
      return handled;
    }
    if (method === 'GET' && path === '/api/v1/users/me') {
      return jsonResponse(200, user);
    }
    if (method === 'GET' && path === '/api/v1/admin/tickets') {
      return jsonResponse(200, ticketPage([]));
    }
    if (method === 'GET' && path === '/api/v1/admin/lost-items') {
      return jsonResponse(200, ticketPage([]));
    }
    if (method === 'GET' && path === '/api/v1/admin/reports') {
      return jsonResponse(200, { items: [], page: 0, size: 20, totalElements: 0 });
    }
    if (method === 'GET' && path === '/api/v1/admin/flags') {
      return jsonResponse(200, { items: [], page: 0, size: 20, totalElements: 0 });
    }
    if (method === 'GET' && path === '/api/v1/admin/sos-events') {
      return jsonResponse(200, { items: [], nextCursor: null });
    }
    return null;
  });
}
