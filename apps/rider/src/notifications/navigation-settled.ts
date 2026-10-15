/**
 * Waits until the signed-in stack is mounted before a push tap navigates.
 *
 * The tap that cold-started the app is read while the (app) layout is still
 * mounting: at that moment the navigation container is not ready yet (no
 * root state) and the signed-in stack has not registered its own state, so a
 * `router.push` issued then is dropped and the rider stays on home — which,
 * with an active ride, IS the ride view. Warm taps find the stack settled
 * and navigate at once.
 */

/** The route group whose stack holds every signed-in screen. */
const SIGNED_IN_GROUP = "(app)";
const POLL_MS = 50;
/** Never strand a tap: after this long, navigate anyway. */
const GIVE_UP_MS = 5000;

interface NavState {
  key?: string;
  stale?: boolean;
  index?: number;
  routes?: { name: string; state?: NavState }[];
}

export interface NavigationRefLike {
  isReady: () => boolean;
  getRootState: () => unknown;
}

function registered(state: NavState | undefined): state is NavState {
  return Boolean(state && state.key && state.stale === false && state.routes);
}

/** True once the container is ready and the signed-in stack has its own (keyed) state. */
export function isSignedInStackSettled(
  ref: NavigationRefLike | null | undefined,
): boolean {
  try {
    if (!ref?.isReady()) return false;
    let state = ref.getRootState() as NavState | undefined;
    while (registered(state)) {
      const routes = state.routes ?? [];
      const route = routes[state.index ?? routes.length - 1];
      if (!route) return false;
      if (route.name === SIGNED_IN_GROUP) return registered(route.state);
      state = route.state;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Runs `navigate` now when the stack is settled, otherwise as soon as it is
 * (polled), or after GIVE_UP_MS at the latest. Returns a cancel.
 */
export function whenSignedInStackSettled(
  ref: NavigationRefLike | null | undefined,
  navigate: () => void,
): () => void {
  if (isSignedInStackSettled(ref)) {
    navigate();
    return () => {};
  }
  const started = Date.now();
  const timer = setInterval(() => {
    if (isSignedInStackSettled(ref) || Date.now() - started >= GIVE_UP_MS) {
      clearInterval(timer);
      navigate();
    }
  }, POLL_MS);
  return () => clearInterval(timer);
}
