import { useCallback, useEffect, useState } from "react";

/**
 * Second-granular countdown for OTP resend buttons (AUTH-04: 60s cooldown).
 * `start(seconds)` arms it; `remaining` ticks down to 0 on one interval
 * (a single interval, not chained timeouts, so fake timers can advance it
 * in one step).
 */
export function useCooldown() {
  const [remaining, setRemaining] = useState(0);
  const active = remaining > 0;

  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  const start = useCallback((seconds: number) => {
    setRemaining(seconds);
  }, []);

  return { remaining, active, start };
}
