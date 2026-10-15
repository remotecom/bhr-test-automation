/**
 * POST /api/gp/guide/publish: add results to data/gp-guide/published.json, the file partners see.
 *
 * Body: { report?: GPRunReport, checks?: GuideCheckResult[] }
 *
 * Merges onto what's already published (new checks replace old ones per case; the report is kept
 * if none is sent), so publishing twice never loses results. Local only: it writes a file in the
 * repo, which you then commit and deploy. The report is sanitized (src/gp/guide/publish.ts).
 */

import { gpRunsRefused } from "@/lib/features";
import { buildPublished, mergePublished } from "@/src/gp/guide/publish";
import { readPublished, writePublished } from "@/src/gp/guide/published-file";

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
  const next = buildPublished(body);
  if (!next.report && next.checks.length === 0) {
    return Response.json({ error: "Nothing to publish: run the report or the guide checks first" }, { status: 400 });
  }
  const published = mergePublished(await readPublished(true), next);
  await writePublished(published);
  return Response.json({
    published,
    file: "data/gp-guide/published.json",
    countries: published.report?.countries.length ?? 0,
    checks: published.checks.length,
  });
}
