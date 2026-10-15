/**
 * Unit tests for the testing guide (data/gp-guide) and its spreadsheet round trip. No network calls.
 * Run with: npx vitest run tests/gp-guide.unit.test.ts
 */

import { describe, expect, it } from "vitest";
import { GUIDE } from "../data/gp-guide";
import { caseGrid, cellText, findInternalRefs, guideFromSheets, type Grid } from "../src/gp/guide/sheet";
import { readGuideXlsx, writeGuideXlsx } from "../src/gp/guide/xlsx";
import { GUIDE_STATUSES, GUIDE_TABS, type Guide } from "../src/gp/guide/types";

describe("GP testing guide: data", () => {
  it("GP-G1 has every tab's cases, unique IDs and known statuses", () => {
    for (const t of GUIDE_TABS) expect(GUIDE.cases.some((c) => c.tab === t.key)).toBe(true);
    const ids = GUIDE.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of GUIDE.cases) expect(GUIDE_STATUSES).toContain(c.status);
  });

  it("GP-G2 contains nothing internal: no ticket IDs, tracker links or merge requests", () => {
    expect(findInternalRefs(GUIDE)).toEqual([]);
  });
});

describe("GP testing guide: spreadsheet", () => {
  it("GP-G3 reads cells as a person would see them", () => {
    expect(cellText(200)).toBe("200");
    expect(cellText("200.0")).toBe("200");
    expect(cellText(new Date("2026-10-07T00:00:00Z"))).toBe("2026-10-07");
    expect(cellText({ formula: 'HYPERLINK("https://x.test","Company Creation Testing Guide")' })).toBe("Company Creation Testing Guide");
    expect(cellText({ formula: "B6-B8", result: 56 })).toBe("56");
  });

  it("GP-G4 ignores internal tabs and refuses internal references in partner tabs", () => {
    const sheets: Record<string, Grid> = {
      Overview: [["Title"], ["Subtitle"]],
      "Known Issues (internal)": [["Ticket"], ["PBYR-4925"]],
      ...Object.fromEntries(GUIDE_TABS.map((t) => [t.title, caseGrid([])])),
    };
    sheets["GP Admin Onboarding"] = caseGrid([
      { id: "A1", tab: "admin", scenario: "s", input: "i", expected: "e", response: "r", notes: "See PBYR-4962", status: "Verified", comments: "" },
    ]);
    const { guide, problems } = guideFromSheets(sheets);
    expect(guide.cases.map((c) => c.id)).toEqual(["A1"]);
    expect(problems.join("\n")).toMatch(/A1 notes: Linear ticket ID/);
    expect(problems.join("\n")).not.toMatch(/Known Issues/);
  });

  it("GP-G5 flags unknown statuses and malformed dates instead of guessing", () => {
    const sheets: Record<string, Grid> = Object.fromEntries(GUIDE_TABS.map((t) => [t.title, caseGrid([])]));
    sheets.Overview = [["T"], ["S"]];
    const grid = caseGrid([{ id: "S1", tab: "setup", scenario: "", input: "", expected: "", response: "", notes: "", status: "Verified", comments: "" }]);
    grid[1][6] = "Done";
    grid[1][8] = "7 Oct";
    sheets.Setup = grid;
    const { problems } = guideFromSheets(sheets);
    expect(problems).toContain('S1: unknown status "Done"');
    expect(problems.some((p) => p.includes('"Last checked" should be YYYY-MM-DD'))).toBe(true);
  });

  it("GP-G6 export then import gives back the same guide", async () => {
    const xlsx = await writeGuideXlsx(GUIDE);
    const { guide, problems } = await readGuideXlsx(xlsx);
    expect(problems).toEqual([]);
    expect(guide).toEqual(GUIDE as Guide);
  });
});
