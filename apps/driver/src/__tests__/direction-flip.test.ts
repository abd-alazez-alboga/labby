/**
 * RTL mirroring around the language-switch restart: I18nManager.forceRTL only
 * mirrors the native layout after a restart, so manual flipping keys on the
 * direction the app LAUNCHED with, never on the live (already-pending) flag.
 */
import { needsManualFlip } from "../i18n/LocaleProvider";

describe("needsManualFlip", () => {
  it("flips by hand after switching to Arabic, before the restart", () => {
    expect(needsManualFlip(true, false)).toBe(true);
  });

  it("lets native RTL mirror once the app restarted into Arabic", () => {
    expect(needsManualFlip(true, true)).toBe(false);
  });

  it("flips back by hand after switching to English, before the restart", () => {
    expect(needsManualFlip(false, true)).toBe(true);
  });

  it("does nothing for English on an LTR launch", () => {
    expect(needsManualFlip(false, false)).toBe(false);
  });
});
