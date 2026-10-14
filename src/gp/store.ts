/**
 * Last-run persistence for the GP capability report.
 * Uses Vercel Blob when available and falls back to data/ (local dev), like the suite's last-run.json.
 */

import fs from "node:fs";
import path from "node:path";
import { head, put } from "@vercel/blob";
import type { GPRunReport } from "./types";

const BLOB_KEY = "gp-capabilities-last-run.json";
const localPath = () => path.join(process.cwd(), "data", BLOB_KEY);

export async function saveGPReport(report: GPRunReport): Promise<void> {
  const json = JSON.stringify(report);
  try {
    await put(BLOB_KEY, json, { access: "public", addRandomSuffix: false, contentType: "application/json" });
    return;
  } catch {
    // Blob not configured, fall through to filesystem
  }
  try {
    fs.mkdirSync(path.dirname(localPath()), { recursive: true });
    fs.writeFileSync(localPath(), json);
  } catch {
    // Best-effort
  }
}

export async function loadGPReport(): Promise<GPRunReport | null> {
  try {
    const meta = await head(BLOB_KEY);
    if (meta?.url) {
      const res = await fetch(meta.url, { cache: "no-store" });
      if (res.ok) return (await res.json()) as GPRunReport;
    }
  } catch {
    // Fall through
  }
  try {
    if (fs.existsSync(localPath())) {
      return JSON.parse(fs.readFileSync(localPath(), "utf-8")) as GPRunReport;
    }
  } catch {
    // Corrupt or unreadable
  }
  return null;
}
