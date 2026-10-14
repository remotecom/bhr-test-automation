import { loadGPReport } from "@/src/gp/store";

export async function GET() {
  const report = await loadGPReport();
  if (!report) return Response.json({ error: "no previous run" }, { status: 404 });
  return Response.json(report);
}
