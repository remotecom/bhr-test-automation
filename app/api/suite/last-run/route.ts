import fs from "node:fs";
import path from "node:path";

export async function GET() {
  const lastRunPath = path.join(process.cwd(), "data", "last-run.json");

  try {
    if (fs.existsSync(lastRunPath)) {
      const data = fs.readFileSync(lastRunPath, "utf-8");
      return new Response(data, {
        headers: { "Content-Type": "application/json" },
      });
    }
    return Response.json({ error: "no previous run" }, { status: 404 });
  } catch {
    return Response.json({ error: "failed to read last run" }, { status: 500 });
  }
}
