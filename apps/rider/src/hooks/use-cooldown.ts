/**
 * Countdown hook for OTP resend cooldowns (AUTH-04: 60 s between sends).
 * `start()` arms the countdown; `secondsLeft` ticks down to 0 once per
 * second; `active` is true while the cooldown is running.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const OTP_RESEND_COOLDOWN_SECONDS = 60;

export function useCooldown(durationSeconds: number = OTP_RESEND_COOLDOWN_SECONDS) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stop();
    setSecondsLeft(durationSeconds);
    intervalRef.current = setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          stop();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  }, [durationSeconds, stop]);

  useEffect(() => stop, [stop]);

  return { secondsLeft, active: secondsLeft > 0, start };
}
