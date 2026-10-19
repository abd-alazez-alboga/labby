import { useLocalSearchParams } from "expo-router";
import React from "react";

import { HelpArticleScreen } from "../components/support/help-article-screen";

export default function HelpArticleRoute() {
  const { helpArticleId, categoryName } = useLocalSearchParams<{
    helpArticleId: string;
    categoryName?: string;
  }>();
  return (
    <HelpArticleScreen
      helpArticleId={helpArticleId ?? ""}
      categoryName={categoryName ?? null}
    />
  );
}
