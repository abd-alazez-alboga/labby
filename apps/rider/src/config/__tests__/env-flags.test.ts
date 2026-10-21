/**
 * L-C1 regression guard: without EXPO_PUBLIC_USE_RN_FETCH, Expo 57 swaps the
 * global fetch for expo/fetch, which rejects React Native {uri,name,type}
 * FormData parts — every photo/file upload fails on device.
 */
interface FsLike {
  readFileSync(path: string, encoding: "utf8"): string;
}
declare const __dirname: string;
const fs: FsLike = jest.requireActual("fs");

describe("apps/rider/.env", () => {
  it("keeps React Native fetch so multipart uploads work", () => {
    const env = fs.readFileSync(`${__dirname}/../../../.env`, "utf8");
    const lines = env
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    expect(lines).toContain("EXPO_PUBLIC_USE_RN_FETCH=1");
  });
});
