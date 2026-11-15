import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** What the mocked rate limiter does on the next call (a plain function, not vi.fn, so no promise tracking). */
const limiter = vi.hoisted(() => ({ next: async (): Promise<void> => {} }));
vi.mock("@/server/rate-limit", () => ({ rateLimit: () => limiter.next() }));

import { getAuth } from "@/server/auth/auth";
import { resetEnvCache } from "@/server/env";
import { HttpError } from "@/server/errors";
import { closeDb } from "@/server/db";

const reset = () => {
  resetEnvCache();
  delete (globalThis as { __leadfinderAuth?: unknown }).__leadfinderAuth;
};

// The per-account sign-in limit is active outside the test environment only.
beforeAll(() => {
  process.env.APP_ENV = "development";
  reset();
});
afterAll(async () => {
  process.env.APP_ENV = "test";
  reset();
  await closeDb();
});

/** Server-side calls surface hook errors as exceptions. */
async function signInError(): Promise<{ statusCode?: number; message?: string }> {
  try {
    await getAuth().api.signInEmail({ body: { email: "someone@example.com", password: "a-long-password-1" } });
  } catch (e) {
    return e as { statusCode?: number; message?: string };
  }
  throw new Error("sign-in unexpectedly succeeded");
}

describe("per-account sign-in limit", () => {
  it("reports a real limit hit as 429", async () => {
    limiter.next = async () => {
      throw new HttpError("rate_limited", "slow down");
    };
    const err = await signInError();
    expect(err.statusCode).toBe(429);
    expect(err.message).toMatch(/15 minutes/);
  });

  it("does not disguise other failures (e.g. database unreachable) as 'too many attempts'", async () => {
    const dbDown = Object.assign(new Error("getaddrinfo ENOTFOUND db.example.supabase.co"), { code: "ENOTFOUND" });
    limiter.next = async () => {
      throw dbDown;
    };
    const err = await signInError();
    expect(err).toBe(dbDown);
    expect(err.statusCode).not.toBe(429);
  });
});
