/**
 * Navigation-container stand-ins for suites that mock expo-router: a ref
 * whose signed-in (app) stack is mounted (warm app), and a controllable one
 * that starts unmounted (cold start) until `settle()` is called.
 */
import type { NavigationRefLike } from "../notifications/navigation-settled";

function rootState(settled: boolean) {
  return settled
    ? {
        key: "root",
        stale: false,
        index: 0,
        routes: [
          {
            name: "(app)",
            state: {
              key: "app",
              stale: false,
              index: 0,
              routes: [{ name: "index" }],
            },
          },
        ],
      }
    : undefined;
}

export const settledNavigationRef: NavigationRefLike = {
  isReady: () => true,
  getRootState: () => rootState(true),
};

export function coldStartNavigationRef(): NavigationRefLike & {
  settle: () => void;
} {
  let settled = false;
  return {
    isReady: () => settled,
    getRootState: () => rootState(settled),
    settle: () => {
      settled = true;
    },
  };
}
