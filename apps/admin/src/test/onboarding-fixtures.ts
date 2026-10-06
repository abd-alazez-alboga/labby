import type { UserProfile } from '../api/auth';
import type {
  AdminDriverApplication,
  ApplicationSummaryPage,
  DocumentRenewal,
  DriverDocument,
  ExpiryDashboard,
  FileRef,
  ServiceTypeRef,
  Vehicle,
  VehicleReview,
  VehicleReviewSummary,
} from '../api/onboarding';
import { adminUser, jsonResponse, stubFetchRoutes, type FetchRouteHandler } from './test-utils';

/**
 * Shared M5 fixtures, shaped exactly like the contract's schemas
 * (onboarding-v1.yaml). File URLs are API-relative tokens, as the local
 * storage provider mints them; dates are far from "today" either way so
 * expiry checks are deterministic.
 */

export const REVIEWER = adminUser(['driver-review:view', 'driver-review:decide']);
export const VIEWER = adminUser(['driver-review:view']);

export const VALID_UNTIL = '2099-12-31';
export const LONG_EXPIRED = '2000-01-01';

/** URL expiry far enough out that no refresh timer fires during a test. */
export function farUrlExpiry(): string {
  return new Date(Date.now() + 60 * 60_000).toISOString();
}

export function fileRef(
  token: string,
  contentType: FileRef['contentType'] = 'image/jpeg',
  urlExpiresAt: string = farUrlExpiry(),
): FileRef {
  return { fileId: `file-${token}`, contentType, url: `/api/v1/files/${token}`, urlExpiresAt };
}

export const APPLICANT = { userId: 'user-7', name: 'Rami Haddad', phone: '+963933000111' };

function document(
  id: string,
  type: DriverDocument['type'],
  file: FileRef,
  extra: Partial<DriverDocument> = {},
): DriverDocument {
  return {
    id,
    type,
    vehicleId: type === 'vehicle_registration' || type === 'insurance' ? 'veh-1' : null,
    number: `${type.toUpperCase()}-001`,
    expiresOn: VALID_UNTIL,
    file,
    reviewStatus: 'pending',
    reviewNote: null,
    submittedAt: '2026-10-01T08:00:00Z',
    ...extra,
  };
}

export function applicationDocuments(): DriverDocument[] {
  return [
    document('doc-id', 'government_id', fileRef('tok-id')),
    document('doc-lic', 'drivers_license', fileRef('tok-lic', 'image/png')),
    document('doc-reg', 'vehicle_registration', fileRef('tok-reg', 'application/pdf')),
    document('doc-ins', 'insurance', fileRef('tok-ins')),
  ];
}

export function applicationVehicle(): Vehicle {
  return {
    id: 'veh-1',
    make: 'Kia',
    model: 'Rio',
    year: 2019,
    color: 'White',
    plate: 'DAM-12345',
    seats: 4,
    photos: [fileRef('tok-car-1'), fileRef('tok-car-2')],
    reviewStatus: 'pending',
    reviewNote: null,
    active: false,
    serviceTypes: [],
    submittedAt: '2026-10-01T08:00:00Z',
  };
}

/** An application already under review — the three decisions are legal. */
export function underReview(extra: Partial<AdminDriverApplication> = {}): AdminDriverApplication {
  return {
    id: 'app-1',
    status: 'under_review',
    submittedAt: '2026-10-01T08:00:00Z',
    decidedAt: null,
    rejectionReason: null,
    personal: {
      name: 'Rami Haddad',
      photo: fileRef('tok-photo'),
      reviewStatus: 'pending',
      reviewNote: null,
    },
    documents: applicationDocuments(),
    vehicle: applicationVehicle(),
    history: [
      { fromStatus: null, toStatus: 'submitted', note: null, at: '2026-10-01T08:00:00Z' },
      { fromStatus: 'submitted', toStatus: 'under_review', note: null, at: '2026-10-02T09:00:00Z' },
    ],
    applicant: APPLICANT,
    duplicatePlate: false,
    ...extra,
  };
}

export const SERVICE_TYPE_REFS: ServiceTypeRef[] = [
  {
    id: 'st-eco',
    regionId: 'region-1',
    regionName: 'Damascus',
    nameEn: 'Economy',
    nameAr: 'اقتصادي',
  },
  {
    id: 'st-comfort',
    regionId: 'region-1',
    regionName: 'Damascus',
    nameEn: 'Comfort',
    nameAr: 'مريح',
  },
];

export function summaryPage(extra: Partial<ApplicationSummaryPage> = {}): ApplicationSummaryPage {
  return {
    items: [
      {
        id: 'app-1',
        applicant: APPLICANT,
        status: 'submitted',
        submittedAt: '2026-10-01T08:00:00Z',
        plate: 'DAM-12345',
        duplicatePlate: false,
      },
      {
        id: 'app-2',
        applicant: { userId: 'user-8', name: 'Lina Saleh', phone: '+963933000222' },
        status: 'under_review',
        submittedAt: '2026-10-02T08:00:00Z',
        plate: 'DAM-777',
        duplicatePlate: true,
      },
    ],
    page: 0,
    size: 25,
    totalItems: 2,
    ...extra,
  };
}

/* ---------- Vehicle switch (UC-A-11) ---------- */

export const SWITCH_SUMMARIES: VehicleReviewSummary[] = [
  {
    vehicleId: 'veh-new',
    driver: APPLICANT,
    make: 'Hyundai',
    model: 'Accent',
    plate: 'DAM-55555',
    submittedAt: '2026-10-03T10:00:00Z',
    duplicatePlate: false,
  },
];

export function vehicleReview(extra: Partial<VehicleReview> = {}): VehicleReview {
  return {
    driver: APPLICANT,
    vehicle: {
      ...applicationVehicle(),
      id: 'veh-new',
      make: 'Hyundai',
      model: 'Accent',
      plate: 'DAM-55555',
      photos: [fileRef('tok-new-car')],
      documents: [
        document('doc-new-reg', 'vehicle_registration', fileRef('tok-new-reg'), {
          vehicleId: 'veh-new',
        }),
        document('doc-new-ins', 'insurance', fileRef('tok-new-ins', 'application/pdf'), {
          vehicleId: 'veh-new',
        }),
      ],
    },
    currentVehicle: {
      ...applicationVehicle(),
      reviewStatus: 'approved',
      active: true,
      serviceTypes: [SERVICE_TYPE_REFS[0]],
    },
    duplicatePlate: false,
    ...extra,
  };
}

/* ---------- Expiry + renewals (UC-A-12) ---------- */

export function renewal(extra: Partial<DocumentRenewal> = {}): DocumentRenewal {
  return {
    driver: APPLICANT,
    renewal: document('doc-renew', 'insurance', fileRef('tok-renew'), {
      number: 'INS-2027',
      expiresOn: '2098-06-30',
      submittedAt: '2026-10-05T07:00:00Z',
    }),
    current: document('doc-ins', 'insurance', fileRef('tok-ins'), {
      number: 'INS-2026',
      expiresOn: LONG_EXPIRED,
      reviewStatus: 'approved',
    }),
    driverSuspended: true,
    ...extra,
  };
}

export function expiryDashboard(horizonDays: number): ExpiryDashboard {
  const upcoming =
    horizonDays === 30
      ? [
          {
            document: document('doc-lic-up', 'drivers_license', fileRef('tok-up-1'), {
              number: 'LIC-30',
              expiresOn: '2026-11-01',
              reviewStatus: 'approved',
            }),
            driver: { userId: 'user-9', name: 'Omar Khalil', phone: '+963933000333' },
            daysLeft: 26,
            driverSuspended: false,
            renewalPending: false,
            reminder30SentAt: '2026-10-02T06:00:00Z',
            reminder7SentAt: null,
          },
          {
            document: document('doc-id-up', 'government_id', fileRef('tok-up-2'), {
              number: 'ID-7',
              expiresOn: '2026-10-10',
              reviewStatus: 'approved',
            }),
            driver: { userId: 'user-10', name: 'Hala Nasser', phone: '+963933000444' },
            daysLeft: 4,
            driverSuspended: false,
            renewalPending: true,
            reminder30SentAt: '2026-09-10T06:00:00Z',
            reminder7SentAt: '2026-10-03T06:00:00Z',
          },
        ]
      : [
          {
            document: document('doc-id-up', 'government_id', fileRef('tok-up-2'), {
              number: 'ID-7',
              expiresOn: '2026-10-10',
              reviewStatus: 'approved',
            }),
            driver: { userId: 'user-10', name: 'Hala Nasser', phone: '+963933000444' },
            daysLeft: 4,
            driverSuspended: false,
            renewalPending: true,
            reminder30SentAt: '2026-09-10T06:00:00Z',
            reminder7SentAt: '2026-10-03T06:00:00Z',
          },
        ];
  return {
    horizonDays,
    upcoming,
    expired: [
      {
        document: document('doc-ins', 'insurance', fileRef('tok-ins'), {
          number: 'INS-2026',
          expiresOn: '2026-10-01',
          reviewStatus: 'approved',
        }),
        driver: APPLICANT,
        daysLeft: -5,
        driverSuspended: true,
        renewalPending: true,
        reminder30SentAt: '2026-09-01T06:00:00Z',
        reminder7SentAt: '2026-09-24T06:00:00Z',
      },
    ],
  };
}

/**
 * Stubs the profile plus every M5 read with the defaults above; `extra`
 * wins, so tests layer decisions/failures on top.
 */
export function stubOnboardingRoutes(user: UserProfile, extra?: FetchRouteHandler) {
  return stubFetchRoutes((method, path, init, url) => {
    const handled = extra?.(method, path, init, url);
    if (handled) {
      return handled;
    }
    if (method !== 'GET') {
      return null;
    }
    switch (path) {
      case '/api/v1/users/me':
        return jsonResponse(200, user);
      case '/api/v1/admin/driver-applications':
        return jsonResponse(200, summaryPage());
      case '/api/v1/admin/driver-applications/app-1':
        return jsonResponse(200, underReview());
      case '/api/v1/admin/assignable-service-types':
        return jsonResponse(200, SERVICE_TYPE_REFS);
      case '/api/v1/admin/vehicle-reviews':
        return jsonResponse(200, SWITCH_SUMMARIES);
      case '/api/v1/admin/vehicle-reviews/veh-new':
        return jsonResponse(200, vehicleReview());
      case '/api/v1/admin/document-renewals':
        return jsonResponse(200, [renewal()]);
      case '/api/v1/admin/document-renewals/doc-renew':
        return jsonResponse(200, renewal());
      case '/api/v1/admin/document-expiries':
        return jsonResponse(
          200,
          expiryDashboard(Number(url?.searchParams.get('horizonDays') ?? '30')),
        );
      default:
        return null;
    }
  });
}

/** The JSON body of the single call made with `method` to `path`. */
export function bodyOf(
  fetchMock: ReturnType<typeof stubFetchRoutes>,
  method: string,
  path: string,
): unknown {
  const calls = fetchMock.mock.calls.filter(
    ([input, init]) =>
      new URL(String(input)).pathname === path && (init?.method ?? 'GET').toUpperCase() === method,
  );
  if (calls.length !== 1) {
    throw new Error(`Expected exactly one ${method} ${path}, got ${calls.length}`);
  }
  const body = calls[0][1]?.body;
  return body === undefined ? undefined : JSON.parse(String(body));
}

/** How many GETs hit `path` (ignoring the query string). */
export function getCount(fetchMock: ReturnType<typeof stubFetchRoutes>, path: string): number {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      new URL(String(input)).pathname === path && (init?.method ?? 'GET').toUpperCase() === 'GET',
  ).length;
}
