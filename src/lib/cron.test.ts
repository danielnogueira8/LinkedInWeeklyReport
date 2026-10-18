import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/weekly/route";
import { cronSetupProblem } from "@/lib/cron";

const request = (authorization?: string) =>
  new Request("https://example.test/api/cron/weekly/20", authorization ? { headers: { authorization } } : {});

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("REPORT_TIMEZONE", "Europe/Lisbon");
  // The route logs why it refused or skipped; keep the test output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("weekly cron", () => {
  it("says so, in the app and to Vercel, when production has no CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(cronSetupProblem()).toMatch(/CRON_SECRET isn't set/);
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/CRON_SECRET isn't set/);
  });

  it("refuses a request without the secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(cronSetupProblem()).toBeNull();
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer wrong"))).status).toBe(401);
  });

  it("skips outside Sunday 21:00 Lisbon time, saying what time it is there", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.useFakeTimers({ now: new Date("2026-10-18T21:37:00Z"), toFake: ["Date"] });
    const res = await GET(request("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      skipped: true,
      reason: "Not the weekly run hour: it's 18 Oct, 22:37 in Europe/Lisbon.",
    });
  });
});
