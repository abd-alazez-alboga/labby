/**
 * M12 helpers: relative day labels, distances, the scheduled ride due
 * within the warning window (ruling 2026-10-16) and the `shared.occupancy`
 * socket frame (scheduled-shared-v1.yaml "Notifications").
 */
import { parseServerFrame } from "../../realtime/protocol";
import { translations } from "../../i18n/translations";
import { openScheduledRide, scheduledRide } from "../../test-utils/m12-fixtures";
import {
  dayOffset,
  formatDistance,
  formatScheduleDay,
  scheduledRideDueSoon,
} from "../schedule-format";

function t(key: string, options?: Record<string, unknown>): string {
  const value = key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], translations.en);
  return String(value).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(options?.[name] ?? ""),
  );
}

const NOW = new Date(2026, 9, 16, 10, 0, 0);

describe("schedule format", () => {
  it("labels today / tomorrow / a later day with the clock", () => {
    expect(dayOffset(new Date(2026, 9, 17, 0, 5), NOW)).toBe(1);
    expect(formatScheduleDay(new Date(2026, 9, 16, 18, 0), "en", t, NOW)).toMatch(
      /^Today · 6:00/,
    );
    expect(formatScheduleDay(new Date(2026, 9, 17, 9, 0), "en", t, NOW, true)).toMatch(
      /^tomorrow · 9:00/,
    );
    expect(formatScheduleDay(new Date(2026, 9, 18, 17, 30), "en", t, NOW)).toMatch(
      /Oct 18 · 5:30/,
    );
  });

  it("formats distances in metres or kilometres", () => {
    expect(formatDistance(612, "en", t)).toBe("600 m");
    expect(formatDistance(1420, "en", t)).toBe("1.4 km");
  });

  it("finds the scheduled ride due within the warning window", () => {
    const soon = scheduledRide({
      scheduled: {
        ...scheduledRide().scheduled!,
        scheduledAt: new Date(NOW.getTime() + 40 * 60 * 1000).toISOString(),
      },
    });
    const later = openScheduledRide();
    expect(scheduledRideDueSoon([later, soon], 60, NOW)?.id).toBe(soon.id);
    expect(scheduledRideDueSoon([later], 60, NOW)).toBeNull();
    expect(scheduledRideDueSoon([soon], 30, NOW)).toBeNull();
  });
});

describe("shared.occupancy frame", () => {
  it("parses the rider's occupancy frame and ignores the driver's", () => {
    expect(
      parseServerFrame(
        JSON.stringify({
          type: "shared.occupancy",
          as: "rider",
          rideId: "r-1",
          seatsTaken: 3,
          totalSeats: 4,
        }),
      ),
    ).toEqual({
      type: "ride",
      event: { type: "shared.occupancy", rideId: "r-1", seatsTaken: 3, totalSeats: 4 },
    });
    expect(
      parseServerFrame(
        JSON.stringify({ type: "shared.occupancy", as: "driver", rideId: "r-1", seatsTaken: 3, totalSeats: 4 }),
      ),
    ).toEqual({ type: "ignored" });
    expect(
      parseServerFrame(JSON.stringify({ type: "shared.occupancy", as: "rider", rideId: "r-1" })),
    ).toEqual({ type: "ignored" });
  });
});
