/**
 * The region time-zone choices of board V1FRegionFloorSettings (V1 audit
 * I23): IANA ids, shown with their current UTC offset. A stored zone outside
 * the list is kept as an extra option so an edit never changes it silently.
 */
export const REGION_TIME_ZONES: readonly string[] = [
  'Asia/Damascus',
  'Asia/Beirut',
  'Europe/Istanbul',
];

/** The zone choices for a region currently on `current`. */
export function timeZoneOptions(current: string): string[] {
  return REGION_TIME_ZONES.includes(current)
    ? [...REGION_TIME_ZONES]
    : [current, ...REGION_TIME_ZONES];
}

/** "UTC+03:00" for the zone right now; null when the runtime does not know the zone. */
export function utcOffset(timeZone: string, at: Date = new Date()): string | null {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((entry) => entry.type === 'timeZoneName')?.value;
    if (!part) {
      return null;
    }
    // "GMT+03:00", or plain "GMT" at offset zero.
    return part === 'GMT' ? 'UTC+00:00' : part.replace('GMT', 'UTC');
  } catch {
    return null;
  }
}
