import { useLocalSearchParams } from "expo-router";
import React from "react";

import HelpArticleScreen from "../../../screens/support/help-article-screen";

export default function HelpArticleRoute() {
  const { helpArticleId } = useLocalSearchParams<{ helpArticleId: string }>();
  return <HelpArticleScreen helpArticleId={helpArticleId} />;
}
