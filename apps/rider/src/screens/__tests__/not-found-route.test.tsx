/**
 * V1 audit I88: an unknown labbyrider:// path redirects home instead of
 * expo-router's English "Unmatched Route" screen.
 */
import { renderRouter, screen, waitFor } from "expo-router/testing-library";
import React from "react";
import { Text } from "react-native";

import NotFoundRoute from "../../app/+not-found";

it("sends an unknown link home", async () => {
  const view = renderRouter(
    {
      index: () => <Text testID="home">home</Text>,
      "+not-found": NotFoundRoute,
    },
    { initialUrl: "/no/such/screen" },
  );

  await waitFor(() => expect(screen.getByTestId("home")).toBeTruthy());
  expect(view.getPathname()).toBe("/");
  expect(screen.queryByText(/Unmatched Route/)).toBeNull();
});
