/**
 * GET /api/gp/guide/published: the testing guide and the published results, for the Payroll tab.
 * Read-only; this is all a partner-facing build shows. Local runs read the file fresh, so a
 * Publish shows up straight away.
 */

import { GUIDE } from "@/data/gp-guide";
import { GP_RUNS } from "@/lib/features";
import { GUIDE_CHECKS } from "@/src/gp/guide/checks";
import { readPublished } from "@/src/gp/guide/published-file";

export async function GET() {
  const automated = Object.fromEntries(Object.entries(GUIDE_CHECKS).map(([id, c]) => [id, c.label]));
  return Response.json({ guide: GUIDE, published: await readPublished(GP_RUNS), automated });
}
