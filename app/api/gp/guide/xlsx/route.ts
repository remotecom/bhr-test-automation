/**
 * GET /api/gp/guide/xlsx: the testing guide as .xlsx, with the latest published automated check per row.
 * The file can be uploaded over the Google Sheet, and re-imported with npm run gp:guide:import.
 */

import { GUIDE, PUBLISHED } from "@/data/gp-guide";
import { writeGuideXlsx } from "@/src/gp/guide/xlsx";

export async function GET() {
  const note = PUBLISHED.publishedAt
    ? `Exported from Remote API Test Lab. Automated checks published ${PUBLISHED.publishedAt.slice(0, 10)}.`
    : "Exported from Remote API Test Lab.";
  const xlsx = await writeGuideXlsx(GUIDE, { generatedNote: note, checks: PUBLISHED.checks });
  return new Response(new Uint8Array(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="gp-sdk-testing-guide-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
