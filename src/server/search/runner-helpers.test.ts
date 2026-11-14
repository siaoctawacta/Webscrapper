import { describe, expect, it } from "vitest";
import { hostOfUrl, runPerHost, STOP_MESSAGES, Throttle } from "./runner-helpers";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe("runPerHost", () => {
  it("never runs two items of the same host at once and respects the global limit", async () => {
    const items = [
      { host: "a.example", id: 1 },
      { host: "a.example", id: 2 },
      { host: "b.example", id: 3 },
      { host: "a.example", id: 4 },
      { host: "c.example", id: 5 },
      { host: "d.example", id: 6 },
      { host: "b.example", id: 7 },
    ];
    const activeHosts = new Map<string, number>();
    let running = 0;
    let maxRunning = 0;
    const done: number[] = [];
    await runPerHost(items, { concurrency: 3, hostOf: (i) => i.host }, async (item) => {
      const n = (activeHosts.get(item.host) ?? 0) + 1;
      activeHosts.set(item.host, n);
      expect(n).toBe(1);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await tick(3);
      running -= 1;
      activeHosts.set(item.host, n - 1);
      done.push(item.id);
    });
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(maxRunning).toBe(3);
  });

  it("treats items without a host as independent", async () => {
    let maxRunning = 0;
    let running = 0;
    await runPerHost([1, 2, 3, 4], { concurrency: 4, hostOf: () => null }, async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await tick(3);
      running -= 1;
    });
    expect(maxRunning).toBe(4);
  });

  it("stops starting new work after abort but waits for in-flight calls", async () => {
    const ac = new AbortController();
    const started: number[] = [];
    let finished = 0;
    await runPerHost([1, 2, 3, 4, 5, 6], { concurrency: 2, hostOf: (i) => `h${i}`, signal: ac.signal }, async (i) => {
      started.push(i);
      if (i === 2) ac.abort();
      await tick(5);
      finished += 1;
    });
    expect(started).toEqual([1, 2]);
    expect(finished).toBe(2);
  });

  it("rejects with the first error after in-flight calls settle", async () => {
    let finished = 0;
    await expect(
      runPerHost([1, 2, 3], { concurrency: 2, hostOf: (i) => `h${i}` }, async (i) => {
        if (i === 1) throw new Error("boom");
        await tick(5);
        finished += 1;
      }),
    ).rejects.toThrow("boom");
    expect(finished).toBe(1);
  });

  it("resolves immediately for no items", async () => {
    await expect(runPerHost([], { concurrency: 2, hostOf: () => "x" }, async () => undefined)).resolves.toBeUndefined();
  });
});

describe("Throttle", () => {
  it("is due at most once per interval", () => {
    let t = 1000;
    const th = new Throttle(1000, () => t);
    expect(th.due()).toBe(true);
    t += 500;
    expect(th.due()).toBe(false);
    t += 500;
    expect(th.due()).toBe(true);
    expect(th.due()).toBe(false);
  });
});

describe("hostOfUrl", () => {
  it("lower-cases and drops www.", () => {
    expect(hostOfUrl("https://WWW.Hotel-Lome.example/contact")).toBe("hotel-lome.example");
    expect(hostOfUrl("hotel.example")).toBe("hotel.example");
    expect(hostOfUrl(null)).toBeNull();
    expect(hostOfUrl("http://")).toBeNull();
  });
});

describe("STOP_MESSAGES", () => {
  it("explains why a search ended in plain language", () => {
    expect(STOP_MESSAGES.exhausted(412, false)).toBe("Google returned all the results it has for this area (412).");
    expect(STOP_MESSAGES.targetReached(1)).toBe("Found the 1 result you asked for.");
    expect(STOP_MESSAGES.targetReached(1000)).toBe("Found the 1,000 results you asked for.");
  });
});
