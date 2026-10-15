/**
 * Unit tests for where published results are stored (src/gp/guide/published-store.ts).
 * Vercel Blob is mocked; no network calls.
 * Run with: npx vitest run tests/gp-published-store.unit.test.ts
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({
  put: vi.fn(async () => ({})),
  get: vi.fn(async () => null as unknown),
}));
vi.mock("@vercel/blob", () => blob);

import { publishedStorage, readPublished, writePublished } from "../src/gp/guide/published-store";
import { PUBLISHED } from "../data/gp-guide";

const sample = { publishedAt: "2026-10-15T19:21:23.282Z", checks: [{ caseId: "A5", outcome: "as_recorded" as const, summary: "ok", details: [], checkedAt: "t" }] };

afterEach(() => {
  vi.unstubAllEnvs();
  blob.put.mockClear();
  blob.get.mockReset();
});

describe("GP published results: Vercel Blob", () => {
  it("GP-P1 publishing writes a private, overwritable current copy and a dated history copy", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    expect(publishedStorage()).toBe("blob");
    expect(await writePublished(sample)).toBe("blob");
    expect(blob.put).toHaveBeenCalledTimes(2);
    const calls = blob.put.mock.calls as unknown as [string, string, Record<string, unknown>][];
    expect(calls[0][0]).toBe("gp-guide/published.json");
    expect(calls[0][2]).toMatchObject({ access: "private", allowOverwrite: true, addRandomSuffix: false });
    expect(calls[1][0]).toBe("gp-guide/history/2026-10-15T19-21-23-282Z.json");
    expect(calls[1][2]).toMatchObject({ access: "private", addRandomSuffix: false });
    expect(calls[1][2].allowOverwrite).toBeUndefined();
    expect(JSON.parse(calls[0][1])).toEqual(sample);
  });

  it("GP-P2 reads bypass the CDN cache, and fall back to the bundled copy when empty or unreadable", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    blob.get.mockResolvedValueOnce({ stream: new Response(JSON.stringify(sample)).body });
    expect(await readPublished(false)).toEqual(sample);
    expect(blob.get).toHaveBeenCalledWith("gp-guide/published.json", { access: "private", useCache: false });

    blob.get.mockResolvedValueOnce(null);
    expect(await readPublished(false)).toBe(PUBLISHED);

    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    blob.get.mockRejectedValueOnce(new Error("store unreachable"));
    expect(await readPublished(false)).toBe(PUBLISHED);
  });

  it("GP-P3 without a token, results stay in the repo file and the store is never touched", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(publishedStorage()).toBe("file");
    expect(await readPublished(false)).toBe(PUBLISHED);
    expect(blob.get).not.toHaveBeenCalled();
  });
});
