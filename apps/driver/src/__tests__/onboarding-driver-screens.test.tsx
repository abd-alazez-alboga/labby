/**
 * M5-T3 — approved-driver screens against onboarding-v1.yaml: vehicle
 * switch (UC-D-18), document renewal (UC-D-19) and the suspended-for-expiry
 * state (DRV-04, USR-04).
 */
import { renderRouter, screen } from "expo-router/testing-library";
import { fireEvent, waitFor } from "@testing-library/react-native";

import type { UserProfile } from "../api/auth-types";
import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import {
  driverUser,
  installContractFetch,
  seedSession,
} from "../test-utils/contract";
import type { MockResponse } from "../test-utils/contract";
import {
  documentFixture,
  isoInDays,
  mockDocumentPick,
  mockLibraryPick,
  pickDate,
  slotFixture,
  uploaded,
  vehicleFixture,
} from "../test-utils/onboarding";

const activeVehicle = vehicleFixture({
  id: "veh-1",
  active: true,
  reviewStatus: "approved",
  serviceTypes: [
    {
      id: "st-1",
      regionId: "r-1",
      regionName: "Damascus",
      nameEn: "Economy",
      nameAr: "اقتصادي",
    },
  ],
});

async function open(
  url: string,
  routes: Record<string, MockResponse | MockResponse[]>,
  user: UserProfile = driverUser(),
) {
  await seedSession(user);
  const contract = installContractFetch({
    "GET /api/v1/users/me": { status: 200, body: user },
    ...routes,
  });
  renderRouter("src/app", { initialUrl: url });
  return contract;
}

const ALL_SLOTS = [
  slotFixture("government_id"),
  slotFixture("drivers_license"),
  slotFixture("vehicle_registration"),
  slotFixture("insurance"),
];

describe("vehicle switch (UC-D-18)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("shows the active vehicle, a pending switch and rejected switches with reasons", async () => {
    await open("/vehicles", {
      "GET /api/v1/driver/vehicles": {
        status: 200,
        body: [
          vehicleFixture({
            id: "veh-3",
            make: "Hyundai",
            model: "Accent",
            plate: "NEW1",
          }),
          vehicleFixture({
            id: "veh-2",
            make: "Toyota",
            model: "Yaris",
            reviewStatus: "rejected",
            reviewNote: "Registration belongs to another owner.",
          }),
          activeVehicle,
        ],
      },
    });

    await screen.findByTestId("vehicle-active");
    expect(screen.getByTestId("vehicle-active")).toHaveTextContent(
      "Kia Rio · 2018",
      {
        exact: false,
      },
    );
    expect(
      screen.getByTestId("vehicle-active-service-types"),
    ).toHaveTextContent("Serves: Economy");
    expect(screen.getByTestId("vehicle-pending")).toHaveTextContent(
      "Hyundai Accent",
      {
        exact: false,
      },
    );
    expect(screen.getByTestId("vehicle-rejected-veh-2")).toHaveTextContent(
      "Registration belongs to another owner.",
      { exact: false },
    );
    // One switch at a time: blocked while one is under review.
    expect(screen.getByTestId("vehicle-switch-blocked")).toBeTruthy();
    expect(
      screen.getByTestId("vehicle-switch-start").props.accessibilityState,
    ).toMatchObject({
      disabled: true,
    });
  });

  it("submits a new vehicle with its registration + insurance (exact body)", async () => {
    const contract = await open("/vehicles", {
      "GET /api/v1/driver/vehicles": [
        { status: 200, body: [activeVehicle] },
        { status: 200, body: [vehicleFixture({ id: "veh-9" }), activeVehicle] },
      ],
      "POST /api/v1/driver/files": [
        uploaded("f-p1", "image/jpeg"),
        uploaded("f-reg", "application/pdf"),
        uploaded("f-ins", "image/png"),
      ],
      "POST /api/v1/driver/vehicles": {
        status: 201,
        body: vehicleFixture({ id: "veh-9" }),
      },
    });

    await screen.findByTestId("vehicle-active");
    fireEvent.press(screen.getByTestId("vehicle-switch-start"));
    expect(await screen.findByTestId("wizard-step-count")).toHaveTextContent(
      "Step 1 of 5",
    );

    fireEvent.changeText(screen.getByTestId("vehicle-make"), "Hyundai");
    fireEvent.changeText(screen.getByTestId("vehicle-model"), "Accent");
    fireEvent.changeText(screen.getByTestId("vehicle-year"), "2020");
    fireEvent.changeText(screen.getByTestId("vehicle-color"), "Silver");
    fireEvent.changeText(screen.getByTestId("vehicle-plate"), "DAM 777");
    fireEvent.changeText(screen.getByTestId("vehicle-seats"), "4");
    fireEvent.press(screen.getByTestId("wizard-next"));

    await screen.findByTestId("step-photos");
    mockLibraryPick("hyundai.jpg");
    fireEvent.press(screen.getByTestId("vehicle-photos-library"));
    await screen.findByTestId("vehicle-photos-tile-0");
    fireEvent.press(screen.getByTestId("wizard-next"));

    await screen.findByTestId("step-doc-vehicle_registration");
    mockDocumentPick("reg.pdf");
    fireEvent.press(screen.getByTestId("document-file-files"));
    await screen.findByTestId("document-file-preview");
    fireEvent.changeText(screen.getByTestId("document-number"), "REG-9");
    pickDate("document-expiry", isoInDays(500));
    fireEvent.press(screen.getByTestId("wizard-next"));

    await screen.findByTestId("step-doc-insurance");
    mockDocumentPick("ins.png", "image/png");
    fireEvent.press(screen.getByTestId("document-file-files"));
    await screen.findByTestId("document-file-preview");
    fireEvent.changeText(screen.getByTestId("document-number"), "INS-9");
    pickDate("document-expiry", isoInDays(200));
    fireEvent.press(screen.getByTestId("wizard-next"));

    await screen.findByTestId("wizard-submit");
    fireEvent.press(screen.getByTestId("wizard-submit"));

    await screen.findByTestId("vehicle-pending");
    expect(contract.requestsTo("POST /api/v1/driver/vehicles")[0].body).toEqual(
      {
        vehicle: {
          make: "Hyundai",
          model: "Accent",
          year: 2020,
          color: "Silver",
          plate: "DAM 777",
          seats: 4,
          photoFileIds: ["f-p1"],
        },
        documents: [
          {
            type: "vehicle_registration",
            number: "REG-9",
            expiresOn: isoInDays(500),
            fileId: "f-reg",
          },
          {
            type: "insurance",
            number: "INS-9",
            expiresOn: isoInDays(200),
            fileId: "f-ins",
          },
        ],
      },
    );
  });

  it("maps a switch 409 to its conflict message", async () => {
    await open("/vehicle-switch", {
      "POST /api/v1/driver/files": [
        uploaded("a"),
        uploaded("b"),
        uploaded("c"),
      ],
      "POST /api/v1/driver/vehicles": {
        status: 409,
        body: { status: 409, message: "switch pending" },
      },
    });
    await screen.findByTestId("step-vehicle");
    fireEvent.changeText(screen.getByTestId("vehicle-make"), "Kia");
    fireEvent.changeText(screen.getByTestId("vehicle-model"), "Picanto");
    fireEvent.changeText(screen.getByTestId("vehicle-year"), "2015");
    fireEvent.changeText(screen.getByTestId("vehicle-color"), "Red");
    fireEvent.changeText(screen.getByTestId("vehicle-plate"), "X1");
    fireEvent.changeText(screen.getByTestId("vehicle-seats"), "3");
    fireEvent.press(screen.getByTestId("wizard-next"));
    await screen.findByTestId("step-photos");
    mockLibraryPick();
    fireEvent.press(screen.getByTestId("vehicle-photos-library"));
    await screen.findByTestId("vehicle-photos-tile-0");
    fireEvent.press(screen.getByTestId("wizard-next"));
    for (const id of ["step-doc-vehicle_registration", "step-doc-insurance"]) {
      await screen.findByTestId(id);
      mockDocumentPick();
      fireEvent.press(screen.getByTestId("document-file-files"));
      await screen.findByTestId("document-file-preview");
      fireEvent.changeText(screen.getByTestId("document-number"), "N1");
      pickDate("document-expiry", isoInDays(100));
      fireEvent.press(screen.getByTestId("wizard-next"));
    }
    await screen.findByTestId("wizard-submit");
    fireEvent.press(screen.getByTestId("wizard-submit"));
    expect(await screen.findByTestId("wizard-error")).toHaveTextContent(
      "You can't submit a vehicle right now — a switch may already be under review.",
    );
  });
});

describe("document renewal (UC-D-19)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("lists the four slots with expiry, pending and rejected renewals", async () => {
    await open("/documents", {
      "GET /api/v1/driver/documents": {
        status: 200,
        body: [
          slotFixture("insurance", {
            expired: true,
            current: documentFixture("insurance", {
              reviewStatus: "approved",
              expiresOn: isoInDays(-2),
            }),
          }),
          slotFixture("government_id", {
            renewal: documentFixture("government_id", {
              id: "ren-1",
              reviewStatus: "pending",
              expiresOn: isoInDays(800),
            }),
          }),
          slotFixture("drivers_license", {
            renewal: documentFixture("drivers_license", {
              id: "ren-2",
              reviewStatus: "rejected",
              reviewNote: "Scan is cut off.",
            }),
          }),
          slotFixture("vehicle_registration"),
        ],
      },
    });

    await screen.findByTestId("slot-insurance");
    expect(screen.getByTestId("documents-expired-banner")).toBeTruthy();
    expect(screen.getByTestId("slot-insurance-expired")).toBeTruthy();
    expect(screen.getByTestId("slot-government_id-pending")).toBeTruthy();
    expect(
      screen.getByTestId("slot-government_id-renew").props.accessibilityState,
    ).toMatchObject({
      disabled: true,
    });
    expect(
      screen.getByTestId("slot-drivers_license-rejected"),
    ).toHaveTextContent("Scan is cut off.", { exact: false });
    expect(
      screen.queryByTestId("slot-vehicle_registration-expired"),
    ).toBeNull();
  });

  it("marks a document inside the 30-day horizon 'Renew soon' and pins its renewal (W19)", async () => {
    await open("/documents", {
      "GET /api/v1/driver/documents": {
        status: 200,
        body: [
          slotFixture("government_id"),
          slotFixture("drivers_license", {
            current: documentFixture("drivers_license", {
              reviewStatus: "approved",
              expiresOn: isoInDays(25),
            }),
          }),
          slotFixture("vehicle_registration"),
          slotFixture("insurance", {
            current: documentFixture("insurance", {
              reviewStatus: "approved",
              expiresOn: isoInDays(20),
            }),
          }),
        ],
      },
    });

    await screen.findByTestId("slot-insurance");
    expect(screen.getByTestId("slot-insurance-soon")).toHaveTextContent(
      "Renew soon",
    );
    expect(screen.getByTestId("slot-drivers_license-soon")).toBeTruthy();
    expect(screen.queryByTestId("slot-government_id-soon")).toBeNull();
    // Board copy (I66): "Expires <date>" / "Valid through <date>", no number.
    expect(screen.getByTestId("slot-insurance")).toHaveTextContent("Expires ", {
      exact: false,
    });
    expect(screen.getByTestId("slot-insurance")).not.toHaveTextContent(
      "INSURANCE-1",
      { exact: false },
    );
    expect(screen.getByText("Documents")).toBeTruthy();
    // The soonest one drives the banner and the pinned primary.
    expect(screen.getByTestId("documents-expiring-banner")).toHaveTextContent(
      "Insurance expires in 20 days.",
      { exact: false },
    );
    expect(screen.queryByTestId("documents-expired-banner")).toBeNull();
    expect(screen.getByTestId("documents-renew-primary")).toHaveTextContent(
      "Renew insurance",
      { exact: false },
    );
  });

  it("shows no 'Renew soon' state past the 30-day horizon", async () => {
    await open("/documents", {
      "GET /api/v1/driver/documents": {
        status: 200,
        body: [
          slotFixture("insurance", {
            current: documentFixture("insurance", {
              reviewStatus: "approved",
              expiresOn: isoInDays(31),
            }),
          }),
        ],
      },
    });

    await screen.findByTestId("slot-insurance");
    expect(screen.queryByTestId("slot-insurance-soon")).toBeNull();
    expect(screen.queryByTestId("documents-expiring-banner")).toBeNull();
    expect(screen.queryByTestId("documents-renew-primary")).toBeNull();
  });

  it("renews a document: inline validation incl. E2, then the exact body", async () => {
    const contract = await open("/documents", {
      "GET /api/v1/driver/documents": { status: 200, body: ALL_SLOTS },
      "POST /api/v1/driver/files": uploaded("f-new-ins", "application/pdf"),
      "POST /api/v1/driver/documents/insurance/renewal": {
        status: 201,
        body: documentFixture("insurance", { reviewStatus: "pending" }),
      },
    });
    await screen.findByTestId("slot-insurance");
    fireEvent.press(screen.getByTestId("slot-insurance-renew"));
    await screen.findByTestId("renew-document-screen");

    fireEvent.press(screen.getByTestId("renewal-submit"));
    expect(await screen.findByText("Add the document file.")).toBeTruthy();
    expect(
      contract.requestsTo("POST /api/v1/driver/documents/insurance/renewal"),
    ).toHaveLength(0);

    mockDocumentPick("ins.pdf");
    fireEvent.press(screen.getByTestId("document-file-files"));
    await screen.findByTestId("document-file-preview");
    fireEvent.changeText(screen.getByTestId("document-number"), "INS-2027");
    pickDate("document-expiry", isoInDays(0));
    fireEvent.press(screen.getByTestId("renewal-submit"));
    expect(
      await screen.findByText(
        "This document has expired or expires today. Use a document that is valid after today.",
      ),
    ).toBeTruthy();
    expect(
      contract.requestsTo("POST /api/v1/driver/documents/insurance/renewal"),
    ).toHaveLength(0);

    pickDate("document-expiry", isoInDays(365));
    fireEvent.press(screen.getByTestId("renewal-submit"));
    await screen.findByTestId("renewal-done");
    expect(
      contract.requestsTo("POST /api/v1/driver/documents/insurance/renewal")[0]
        .body,
    ).toEqual({
      number: "INS-2027",
      expiresOn: isoInDays(365),
      fileId: "f-new-ins",
    });
  });

  it("maps flat server fieldErrors and the 409 already-pending answer", async () => {
    await open("/renew-document?type=drivers_license", {
      "POST /api/v1/driver/files": uploaded("f-lic", "image/jpeg"),
      "POST /api/v1/driver/documents/drivers_license/renewal": [
        {
          status: 400,
          body: {
            status: 400,
            message: "Validation failed",
            fieldErrors: { expiresOn: "must be after today" },
          },
        },
        { status: 409, body: { status: 409, message: "pending" } },
      ],
    });
    await screen.findByTestId("renew-document-screen");
    mockDocumentPick("lic.jpg", "image/jpeg");
    fireEvent.press(screen.getByTestId("document-file-files"));
    await screen.findByTestId("document-file-preview");
    fireEvent.changeText(screen.getByTestId("document-number"), "LIC-1");
    pickDate("document-expiry", isoInDays(30));

    fireEvent.press(screen.getByTestId("renewal-submit"));
    expect(
      await screen.findByTestId("document-expiry-error"),
    ).toHaveTextContent(
      "The expiry date was not accepted. It must be after today.",
    );

    fireEvent.press(screen.getByTestId("renewal-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("renewal-error")).toHaveTextContent(
        "A renewal of this document is already waiting for review.",
      ),
    );
  });

  it("explains the not-approved (409) state", async () => {
    await open("/documents", {
      "GET /api/v1/driver/documents": {
        status: 409,
        body: { status: 409, message: "no" },
      },
    });
    expect(await screen.findByTestId("documents-not-approved")).toBeTruthy();
  });

  it("reaches vehicles and documents from driver home (via the menu)", async () => {
    await open("/", {
      "GET /api/v1/meta": {
        status: 200,
        body: { name: "labby-backend", version: "0.1.0" },
      },
      "GET /api/v1/driver/documents": { status: 200, body: ALL_SLOTS },
    });
    await screen.findByTestId("home-screen");
    fireEvent.press(screen.getByTestId("settings-link"));
    expect(await screen.findByTestId("vehicles-link")).toBeTruthy();
    fireEvent.press(screen.getByTestId("documents-link"));
    expect(await screen.findByTestId("slot-government_id")).toBeTruthy();
  });
});

describe("suspended-for-expiry state (DRV-04, USR-04)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  const expiredDriver = driverUser({
    roles: [
      { role: "rider", state: "active" },
      {
        role: "driver",
        state: "suspended",
        suspensionReason: "document_expired",
      },
    ],
  });

  it("shows the expiry reason and leads straight to renewal", async () => {
    await open(
      "/",
      {
        "GET /api/v1/driver/documents": {
          status: 200,
          body: [
            ...ALL_SLOTS.slice(0, 3),
            slotFixture("insurance", {
              expired: true,
              current: documentFixture("insurance", {
                reviewStatus: "approved",
                expiresOn: isoInDays(-1),
              }),
            }),
          ],
        },
      },
      expiredDriver,
    );

    await screen.findByTestId("gate-expired");
    expect(screen.getByTestId("gate-title")).toHaveTextContent(
      "Driving paused: a document expired",
    );
    expect(screen.queryByTestId("home-screen")).toBeNull();

    fireEvent.press(screen.getByTestId("gate-renew"));
    expect(await screen.findByTestId("slot-insurance-expired")).toBeTruthy();
    fireEvent.press(screen.getByTestId("slot-insurance-renew"));
    expect(await screen.findByTestId("renew-document-screen")).toBeTruthy();
  });

  it("unlocks driver home once a re-read profile shows the role active again", async () => {
    await open(
      "/",
      {
        "GET /api/v1/meta": {
          status: 200,
          body: { name: "labby-backend", version: "0.1.0" },
        },
      },
      expiredDriver,
    );
    // Boot refresh keeps the suspension; the "check status" refresh lifts it.
    await screen.findByTestId("gate-expired");
    installContractFetch({
      "GET /api/v1/users/me": { status: 200, body: driverUser() },
      "GET /api/v1/meta": {
        status: 200,
        body: { name: "labby-backend", version: "0.1.0" },
      },
    });
    fireEvent.press(screen.getByTestId("gate-check-status"));
    expect(await screen.findByTestId("home-screen")).toBeTruthy();
  });

  it("keeps the generic suspended copy for other or unknown reasons", async () => {
    await open(
      "/",
      {},
      driverUser({
        roles: [
          { role: "rider", state: "active" },
          { role: "driver", state: "suspended", suspensionReason: null },
        ],
      }),
    );
    await screen.findByTestId("apply-to-drive-screen");
    expect(screen.getByTestId("gate-title")).toHaveTextContent(
      "Driver access suspended",
    );
    expect(screen.queryByTestId("gate-renew")).toBeNull();
  });
});
