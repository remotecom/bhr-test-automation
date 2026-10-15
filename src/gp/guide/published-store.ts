/**
 * Where published results live (server only).
 *
 *   blob  Vercel Blob, when BLOB_READ_WRITE_TOKEN is set (a private store connected to the Vercel
 *         project, and the same token in a local .env). Publish from a local run goes live for
 *         partners straight away. Each publish overwrites gp-guide/published.json and keeps a
 *         dated copy in gp-guide/history/.
 *   file  data/gp-guide/published.json in the repo, when no store is set up. Commit and deploy
 *         the file to share it.
 *
 * Reads are always fresh (no CDN cache), so partners see a publish on their next page load.
 * If the store can't be read, the copy bundled with the build is shown instead.
 */

import { readFile, writeFile } from "fs/promises";
import path from "path";
import { get, put } from "@vercel/blob";
import { PUBLISHED } from "../../../data/gp-guide";
import type { GuidePublished } from "./publish";

export type PublishedStorage = "blob" | "file";

const BLOB_PATH = "gp-guide/published.json";
const FILE = () => path.join(process.cwd(), "data/gp-guide/published.json");

export const publishedStorage = (): PublishedStorage => (process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "file");

/** The published results. `fresh` re-reads the local file (local runs); the store is always read fresh. */
export async function readPublished(fresh: boolean): Promise<GuidePublished> {
  if (publishedStorage() === "blob") {
    try {
      const res = await get(BLOB_PATH, { access: "private", useCache: false });
      if (!res?.stream) return PUBLISHED; // nothing published to the store yet
      return JSON.parse(await new Response(res.stream).text()) as GuidePublished;
    } catch (err) {
      console.error(`[gp published] reading ${BLOB_PATH} failed, showing the bundled copy: ${err instanceof Error ? err.message : err}`);
      return PUBLISHED;
    }
  }
  if (!fresh) return PUBLISHED;
  try {
    return JSON.parse(await readFile(FILE(), "utf8")) as GuidePublished;
  } catch {
    return PUBLISHED;
  }
}

export async function writePublished(p: GuidePublished): Promise<PublishedStorage> {
  const body = JSON.stringify(p, null, 2) + "\n";
  if (publishedStorage() === "blob") {
    const opts = { access: "private" as const, contentType: "application/json", addRandomSuffix: false };
    await put(BLOB_PATH, body, { ...opts, allowOverwrite: true });
    const stamp = (p.publishedAt || new Date().toISOString()).replace(/[:.]/g, "-");
    await put(`gp-guide/history/${stamp}.json`, body, opts);
    return "blob";
  }
  await writeFile(FILE(), body);
  return "file";
}
