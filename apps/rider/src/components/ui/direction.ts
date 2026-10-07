/**
 * Direction helpers shared by the ui primitives. `flipRows` is true only while
 * the locale is RTL but the native layout has not restarted into RTL yet (see
 * locale-context) — that is when rows and absolute start/end must be flipped
 * by hand. Directional icons (chevrons) follow `isRTL` always.
 */
import { type ViewStyle } from "react-native";

import { useOptionalLocale } from "../../i18n/locale-context";

export interface Direction {
  isRTL: boolean;
  flipRows: boolean;
  /** `flexDirection` for a horizontal row in the active direction. */
  row: ViewStyle["flexDirection"];
  /** Chevron pointing "forward" (into a detail screen). */
  forwardChevron: "chevron-forward" | "chevron-back";
  /** Chevron pointing "back". */
  backChevron: "chevron-back" | "chevron-forward";
}

export function useDirection(): Direction {
  const locale = useOptionalLocale();
  const isRTL = locale?.isRTL ?? false;
  const flipRows = locale?.flipRows ?? false;
  return {
    isRTL,
    flipRows,
    row: flipRows ? "row-reverse" : "row",
    forwardChevron: isRTL ? "chevron-back" : "chevron-forward",
    backChevron: isRTL ? "chevron-forward" : "chevron-back",
  };
}
