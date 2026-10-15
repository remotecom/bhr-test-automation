/**
 * POST /api/gp/guide/publish: add results to what partners see (src/gp/guide/published-store.ts).
 *
 * Body: { report?: GPRunReport, checks?: GuideCheckResult[] }
 *
 * Merges onto what's already published (new checks replace old ones per case; the report is kept
 * if none is sent), so publishing twice never loses results. Local runs only. With Vercel Blob set
 * up it goes live at once; otherwise it writes data/gp-guide/published.json to commit and deploy.
 * The report is sanitized (src/gp/guide/publish.ts).
 */

import { gpRunsRefused } from "@/lib/features";
import { buildPublished, mergePublished } from "@/src/gp/guide/publish";
import { publishedStorage, readPublished, writePublished } from "@/src/gp/guide/published-store";

export async function POST(request: Request) {
  const refused = gpRunsRefused();
  if (refused) return refused;
  if (process.env.VERCEL && publishedStorage() === "file") {
    return Response.json({ error: "No results store is set up, and this deploy can't write files. Publish from a local run." }, { status: 403 });
  }

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
  const storage = await writePublished(published);
  return Response.json({
    published,
    storage,
    countries: published.report?.countries.length ?? 0,
    checks: published.checks.length,
  });
}
