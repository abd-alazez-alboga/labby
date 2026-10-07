import { Ionicons } from "@expo/vector-icons";
import React from "react";

import { colors } from "../../theme/tokens";
import { useDirection } from "./text";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** 20 px stroke icon in the text colour unless told otherwise. */
export function Icon({
  name,
  size = 20,
  color = colors.text,
  testID,
}: {
  name: IconName;
  size?: number;
  color?: string;
  testID?: string;
}) {
  return <Ionicons name={name} size={size} color={color} testID={testID} />;
}

/**
 * A chevron that follows the reading direction: `forward` points right in
 * LTR and left in RTL (row chevrons); `back` is the mirror (back buttons).
 */
export function Chevron({
  direction,
  size = 18,
  color = colors.textMuted,
  testID,
}: {
  direction: "forward" | "back";
  size?: number;
  color?: string;
  testID?: string;
}) {
  const { rtl } = useDirection();
  const pointsRight = (direction === "forward") !== rtl;
  return (
    <Ionicons
      name={pointsRight ? "chevron-forward" : "chevron-back"}
      size={size}
      color={color}
      testID={testID}
    />
  );
}
