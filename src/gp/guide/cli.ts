/**
 * Testing guide CLI: move the guide between the repo and a spreadsheet.
 *
 *   npm run gp:guide:export [-- out.xlsx]        write the guide as .xlsx (default: gp-testing-guide.xlsx)
 *   npm run gp:guide:import -- file.xlsx         read an .xlsx (e.g. downloaded from Google Sheets) into data/gp-guide/guide.json
 *
 * Import ignores tabs it doesn't know (such as "Known Issues (internal)") and refuses text that
 * names internal tickets, so nothing internal reaches the partner-facing guide. Review the
 * change with `git diff data/gp-guide/guide.json` before committing.
 */

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { readGuideXlsx, writeGuideXlsx } from "./xlsx";
import type { Guide } from "./types";

// Run from the repo root (npm scripts do)
const GUIDE_PATH = path.resolve("data/gp-guide/guide.json");

async function main() {
  const [cmd, file] = process.argv.slice(2);
  if (cmd === "export") {
    const guide = JSON.parse(readFileSync(GUIDE_PATH, "utf8")) as Guide;
    const out = file || "gp-testing-guide.xlsx";
    writeFileSync(out, await writeGuideXlsx(guide));
    console.log(`Wrote ${out}: ${guide.cases.length} test cases`);
    return;
  }
  if (cmd === "import") {
    if (!file) throw new Error("Usage: npm run gp:guide:import -- <file.xlsx>");
    const { guide, problems } = await readGuideXlsx(readFileSync(file));
    if (problems.length) {
      console.error(`Not imported. Fix these in the spreadsheet and try again:\n- ${problems.join("\n- ")}`);
      process.exit(1);
    }
    writeFileSync(GUIDE_PATH, JSON.stringify(guide, null, 2) + "\n");
    console.log(`Imported ${guide.cases.length} test cases into data/gp-guide/guide.json. Review with: git diff data/gp-guide/guide.json`);
    return;
  }
  throw new Error("Usage: gp:guide:export [out.xlsx] | gp:guide:import <file.xlsx>");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
