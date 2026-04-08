import fs from "node:fs";
import path from "node:path";
import { head } from "@vercel/blob";

export async function GET() {
  // Try Vercel Blob first (works on Vercel), fall back to filesystem (local dev)
  try {
    const meta = await head("last-run.json");
    if (meta?.url) {
      const res = await fetch(meta.url);
      if (res.ok) {
        const data = await res.text();
        return new Response(data, {
          headers: { "Content-Type": "application/json" },
        });
      }
    }
  } catch {
    // Blob not available, fall through to filesystem
  }

  // Filesystem fallback (local dev)
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
