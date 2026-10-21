import { renderRouter } from "expo-router/testing-library";
import React from "react";

import { AuthProvider } from "../auth/AuthProvider";
import { BalanceScreen } from "../components/money/balance-screen";
import { EarningsScreen } from "../components/money/earnings-screen";
import ReportRiderRoute from "../app/report-rider";
import ReportsRoute from "../app/reports";
import TripDetailRoute from "../app/trip-detail";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { DriverMoneyProvider } from "../money/DriverMoneyProvider";
import { driverUser, installContractFetch, seedSession } from "./contract";
import type { ContractFetch, MockResponse } from "./contract";

/**
 * The M8 money screens under test: the real providers (auth + money facade)
 * around the real earnings / balance routes, the API mocked at the fetch
 * boundary (money-v1.yaml shaped).
 */
export async function renderMoneyScreens(
  routes: Record<string, MockResponse | MockResponse[]>,
  options: { language?: "en" | "ar"; initialUrl: string },
): Promise<ContractFetch> {
  await seedSession(driverUser());
  const contract = installContractFetch(routes);
  const language = options.language ?? "en";
  renderRouter(
    {
      _layout: () => {
        const { Slot } = jest.requireActual("expo-router");
        return (
          <LocaleProvider initialLanguage={language}>
            <AuthProvider>
              <DriverMoneyProvider>
                <Slot />
              </DriverMoneyProvider>
            </AuthProvider>
          </LocaleProvider>
        );
      },
      earnings: () => <EarningsScreen />,
      balance: () => <BalanceScreen />,
      "trip-detail": () => <TripDetailRoute />,
      "report-rider": () => <ReportRiderRoute />,
      reports: () => <ReportsRoute />,
    },
    { initialUrl: options.initialUrl },
  );
  return contract;
}
