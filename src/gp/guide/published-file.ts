/**
 * Reading and writing data/gp-guide/published.json on the server.
 *
 * Local runs read the file fresh on every request: the bundled copy (PUBLISHED) can lag behind a
 * Publish in dev, and publishing on top of a stale copy would drop results. Deployed builds can't
 * write, so they use the bundled copy.
 */

import { readFile, writeFile } from "fs/promises";
import path from "path";
import { PUBLISHED } from "../../../data/gp-guide";
import type { GuidePublished } from "./publish";

const FILE = () => path.join(process.cwd(), "data/gp-guide/published.json");

export async function readPublished(fresh: boolean): Promise<GuidePublished> {
  if (!fresh) return PUBLISHED;
  try {
    return JSON.parse(await readFile(FILE(), "utf8")) as GuidePublished;
  } catch {
    return PUBLISHED;
  }
}

export async function writePublished(p: GuidePublished): Promise<void> {
  await writeFile(FILE(), JSON.stringify(p, null, 2) + "\n");
}
