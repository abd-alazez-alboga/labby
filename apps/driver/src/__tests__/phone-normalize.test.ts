import { PHONE_PATTERN } from "../api/auth-types";
import { normalizePhone } from "../api/phone";

/** H3 (owner ruling 2026-10-20): E.164 with a Syria default, mirroring the backend. */
describe("normalizePhone", () => {
  it.each([
    ["0933000111", "+963933000111"],
    ["0933 000 111", "+963933000111"],
    ["0933-000-111", "+963933000111"],
    ["00963933000111", "+963933000111"],
    ["963933000111", "+963933000111"],
    ["+963933000111", "+963933000111"],
    ["+963 933 000 111", "+963933000111"],
    ["  0933000111  ", "+963933000111"],
  ])("canonicalizes %p to %p", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
    expect(PHONE_PATTERN.test(normalizePhone(input))).toBe(true);
  });

  it("keeps any number already written with a plus sign", () => {
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
  });

  it("leaves other shapes stripped but unchanged for the server to judge", () => {
    expect(normalizePhone("12345678")).toBe("12345678");
    expect(normalizePhone("093300011")).toBe("093300011");
    expect(normalizePhone("")).toBe("");
  });
});
