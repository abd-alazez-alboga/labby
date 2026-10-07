import type {
  DriverApplication,
  DriverDocument,
} from "../api/onboarding-types";
import { DOCUMENT_TYPES } from "../api/onboarding-types";

export interface FlaggedItems {
  personal: boolean;
  /** Flagged documents, in application order. */
  documents: DriverDocument[];
  vehicle: boolean;
}

/** The items a reviewer flagged (`changes_requested`) — UC-D-02. */
export function flaggedItems(application: DriverApplication): FlaggedItems {
  const documents = DOCUMENT_TYPES.map((type) =>
    application.documents.find((document) => document.type === type),
  ).filter(
    (document): document is DriverDocument =>
      !!document && document.reviewStatus === "changes_requested",
  );
  return {
    personal: application.personal.reviewStatus === "changes_requested",
    documents,
    vehicle: application.vehicle.reviewStatus === "changes_requested",
  };
}
