/**
 * GET /api/gp/capabilities/export?format=md|matrix|test-cases|json
 *
 * Downloads the last saved GP capability report. Handy for scripts and CI, or
 * for sharing a link with someone who is already logged in to the dashboard.
 */

import { loadGPReport } from "@/src/gp/store";
import { exportFilename, toMarkdown, toMatrixCSV, toTestCasesCSV } from "@/src/gp/export";

export async function GET(request: Request) {
  const report = await loadGPReport();
  if (!report) return Response.json({ error: "no previous run" }, { status: 404 });

  const format = new URL(request.url).searchParams.get("format") || "md";
  let body: string;
  let type: string;
  let filename: string;

  switch (format) {
    case "matrix":
      body = toMatrixCSV(report);
      type = "text/csv";
      filename = exportFilename(report, "matrix", "csv");
      break;
    case "test-cases":
      body = toTestCasesCSV(report);
      type = "text/csv";
      filename = exportFilename(report, "test-cases", "csv");
      break;
    case "json":
      body = JSON.stringify(report, null, 2);
      type = "application/json";
      filename = exportFilename(report, "report", "json");
      break;
    case "md":
    default:
      body = toMarkdown(report);
      type = "text/markdown";
      filename = exportFilename(report, "report", "md");
  }

  return new Response(body, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
