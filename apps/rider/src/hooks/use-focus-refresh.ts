import * as Router from "expo-router";
import { type EffectCallback, useEffect } from "react";

/**
 * Runs `effect` whenever the screen gains focus (expo-router's
 * `useFocusEffect`) — or on mount where no navigator provides focus (a
 * router mock without it in provider-less screen tests). `effect` must be
 * memoized (useCallback) like for `useFocusEffect`.
 */
function useMountEffect(effect: EffectCallback): void {
  useEffect(effect, [effect]);
}

export const useFocusRefresh: (effect: EffectCallback) => void =
  typeof Router.useFocusEffect === "function"
    ? Router.useFocusEffect
    : useMountEffect;
