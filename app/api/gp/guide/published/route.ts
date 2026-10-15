/**
 * GET /api/gp/guide/published: the testing guide and the published results, for the Payroll tab.
 * Read-only; this is all a partner-facing build shows. Results are read fresh (store, or the local
 * file in local runs), so a Publish shows up on the next page load.
 */

import { GUIDE } from "@/data/gp-guide";
import { GP_RUNS } from "@/lib/features";
import { GUIDE_CHECKS } from "@/src/gp/guide/checks";
import { publishedStorage, readPublished } from "@/src/gp/guide/published-store";

export async function GET() {
  const automated = Object.fromEntries(Object.entries(GUIDE_CHECKS).map(([id, c]) => [id, c.label]));
  return Response.json({ guide: GUIDE, published: await readPublished(GP_RUNS), automated, storage: publishedStorage() });
}
