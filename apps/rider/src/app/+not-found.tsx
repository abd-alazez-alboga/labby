import { Redirect } from "expo-router";
import React from "react";

/**
 * An unknown `labbyrider://` link (V1 audit I88) never shows expo-router's
 * English "Unmatched Route" screen: it lands on home, which sends a
 * signed-out user to the welcome screen. Notification deep links are
 * mapped before routing (notifications/deep-links.ts) and never get here.
 */
export default function NotFoundRoute() {
  return <Redirect href="/" />;
}
