/**
 * POST /api/gp/guide/publish: write the results partners will see to data/gp-guide/published.json.
 *
 * Body: { report?: GPRunReport, checks?: GuideCheckResult[] }
 *
 * Local only: it writes a file in the repo, which you then commit and deploy. Refused where runs
 * are off and on Vercel (read-only filesystem). The report is sanitized (src/gp/guide/publish.ts).
 */

import { writeFile } from "fs/promises";
import path from "path";
import { gpRunsRefused } from "@/lib/features";
import { buildPublished } from "@/src/gp/guide/publish";

export async function POST(request: Request) {
  const refused = gpRunsRefused();
  if (refused) return refused;
  if (process.env.VERCEL) return Response.json({ error: "Publish from a local run, then commit data/gp-guide/published.json" }, { status: 403 });

  let body: { report?: unknown; checks?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const published = buildPublished(body);
  if (!published.report && published.checks.length === 0) {
    return Response.json({ error: "Nothing to publish: run the report or the guide checks first" }, { status: 400 });
  }
  const file = path.join(process.cwd(), "data/gp-guide/published.json");
  await writeFile(file, JSON.stringify(published, null, 2) + "\n");
  return Response.json({
    publishedAt: published.publishedAt,
    file: "data/gp-guide/published.json",
    countries: published.report?.countries.length ?? 0,
    checks: published.checks.length,
  });
}
