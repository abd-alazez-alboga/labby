import { Stack, useLocalSearchParams } from "expo-router";
import React from "react";

import HelpCategoryScreen from "../../../screens/support/help-category-screen";

export default function HelpCategoryRoute() {
  const { helpCategoryId, name } = useLocalSearchParams<{
    helpCategoryId: string;
    name?: string;
  }>();
  return (
    <>
      {/* The category's localized name arrives as a param from the list. */}
      <Stack.Screen options={{ title: name ?? "" }} />
      <HelpCategoryScreen helpCategoryId={helpCategoryId} />
    </>
  );
}
