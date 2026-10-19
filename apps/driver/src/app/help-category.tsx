import { useLocalSearchParams } from "expo-router";
import React from "react";

import { HelpCategoryScreen } from "../components/support/help-category-screen";

export default function HelpCategoryRoute() {
  const { helpCategoryId, nameEn, nameAr, count } = useLocalSearchParams<{
    helpCategoryId: string;
    nameEn?: string;
    nameAr?: string;
    count?: string;
  }>();
  const parsed = Number(count);
  return (
    <HelpCategoryScreen
      helpCategoryId={helpCategoryId ?? ""}
      nameEn={nameEn ?? ""}
      nameAr={nameAr ?? ""}
      count={Number.isFinite(parsed) && count !== undefined ? parsed : null}
    />
  );
}
