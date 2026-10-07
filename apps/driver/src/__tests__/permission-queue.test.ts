import { runExclusive } from "../permissions/permission-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () =>
  new Promise<void>((resolve) => setImmediate(() => resolve()));

describe("runExclusive (one OS permission dialog at a time)", () => {
  it("runs two concurrent prompts one after the other", async () => {
    const events: string[] = [];
    const location = deferred<string>();
    const push = deferred<string>();

    const first = runExclusive(() => {
      events.push("location:start");
      return location.promise;
    });
    const second = runExclusive(() => {
      events.push("push:start");
      return push.promise;
    });

    await flush();
    // The notification prompt waits while the location dialog is up.
    expect(events).toEqual(["location:start"]);

    location.resolve("granted");
    await expect(first).resolves.toBe("granted");
    await flush();
    expect(events).toEqual(["location:start", "push:start"]);

    push.resolve("denied");
    await expect(second).resolves.toBe("denied");
  });

  it("a failed prompt does not block the next one", async () => {
    const failing = runExclusive(() => Promise.reject(new Error("boom")));
    const next = runExclusive(async () => "granted");

    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("granted");
  });
});
