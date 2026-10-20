import { isValidPhone, normalizePhone } from "../auth";

/** V1 audit H3 (owner ruling): one handset, one canonical E.164 number. */
describe("normalizePhone", () => {
  it.each([
    ["0933000111", "+963933000111"],
    ["0933 000 111", "+963933000111"],
    ["0933-000-111", "+963933000111"],
    ["00963933000111", "+963933000111"],
    ["00 963 933 000 111", "+963933000111"],
    ["963933000111", "+963933000111"],
    ["+963933000111", "+963933000111"],
    ["+963 933-000-111", "+963933000111"],
    [" +963933000111 ", "+963933000111"],
  ])("canonicalizes %j to %s", (typed, canonical) => {
    expect(normalizePhone(typed)).toBe(canonical);
    expect(isValidPhone(normalizePhone(typed))).toBe(true);
  });

  it("keeps other international numbers as typed (compacted)", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("+9715 0123 4567")).toBe("+971501234567");
  });

  it("leaves malformed input for validation to refuse", () => {
    expect(normalizePhone("0933 000")).toBe("0933000");
    expect(normalizePhone("09330001112")).toBe("09330001112");
    expect(normalizePhone("")).toBe("");
    expect(isValidPhone(normalizePhone("0933 000"))).toBe(false);
    expect(isValidPhone(normalizePhone("abc"))).toBe(false);
  });
});
