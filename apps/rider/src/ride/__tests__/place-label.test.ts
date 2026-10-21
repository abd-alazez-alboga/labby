/**
 * L-W2: current-location / dropped-pin points are sent with `label: null`;
 * every client names them in its own language at display time. Real labels
 * (search results, saved places, older rides stored with English text) are
 * shown as they are.
 */
import { translations } from "../../i18n/translations";
import { placeCoordsLabel, placeLabel } from "../ride-format";

function tIn(locale: "en" | "ar") {
  return (key: string) =>
    String(
      key
        .split(".")
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown>)?.[part],
          translations[locale],
        ),
    );
}

const point = { lat: 33.51234, lng: 36.27651 };

describe("placeLabel", () => {
  it("names an unlabelled point in the app language", () => {
    expect(placeLabel({ ...point, label: null }, tIn("en"))).toBe("Pinned location");
    expect(placeLabel({ ...point, label: "  " }, tIn("en"))).toBe("Pinned location");
    expect(placeLabel(point, tIn("ar"))).toBe("موقع محدد على الخريطة");
  });

  it("keeps a real label, including one stored by an older app version", () => {
    expect(placeLabel({ ...point, label: " Damascus Airport " }, tIn("ar"))).toBe(
      "Damascus Airport",
    );
    expect(placeLabel({ ...point, label: "Current location" }, tIn("ar"))).toBe(
      "Current location",
    );
    expect(placeLabel(null, tIn("en"))).toBe("");
  });

  it("saved places still fall back to coordinates", () => {
    expect(placeCoordsLabel(point)).toBe("33.51234, 36.27651");
    expect(placeCoordsLabel({ ...point, label: "Home" })).toBe("Home");
  });
});
