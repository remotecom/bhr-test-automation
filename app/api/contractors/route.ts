import fs from "node:fs";
import path from "node:path";

export async function GET() {
  try {
    const dataDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      return Response.json({});
    }
    const files = fs
      .readdirSync(dataDir)
      .filter((f) => f.endsWith(".json") && f !== "last-run.json" && f !== "mega-run.json");
    const contractors: Record<string, unknown> = {};
    for (const file of files) {
      const raw = fs.readFileSync(path.join(dataDir, file), "utf-8");
      const data = JSON.parse(raw);
      const code = file.replace(".json", "");
      contractors[code] = data;
    }
    return Response.json(contractors);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
