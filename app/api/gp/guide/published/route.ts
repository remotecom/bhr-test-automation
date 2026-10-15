/**
 * GET /api/gp/guide/published: the testing guide and the published results, for the Payroll tab.
 * Read-only; this is all a partner-facing build shows.
 */

import { GUIDE, PUBLISHED } from "@/data/gp-guide";
import { GUIDE_CHECKS } from "@/src/gp/guide/checks";

export async function GET() {
  const automated = Object.fromEntries(Object.entries(GUIDE_CHECKS).map(([id, c]) => [id, c.label]));
  return Response.json({ guide: GUIDE, published: PUBLISHED, automated });
}
