/**
 * The GP SDK testing guide, as shown on the Payroll tab and exported to .xlsx.
 *
 * guide.json is the source of truth. Edit it directly, or round-trip through a spreadsheet:
 *   npm run gp:guide:export -- guide.xlsx   then edit in Excel / Google Sheets, download as .xlsx
 *   npm run gp:guide:import -- guide.xlsx
 * Partner-facing: keep internal tickets and tracking out (the import and a unit test refuse them).
 *
 * published.json holds the results partners see, written by the Publish button in a local run
 * (see src/gp/guide/publish.ts). Commit it to publish.
 */

import type { Guide } from "../../src/gp/guide/types";
import type { GuidePublished } from "../../src/gp/guide/publish";
import guideJson from "./guide.json";
import publishedJson from "./published.json";

export const GUIDE = guideJson as Guide;
export const PUBLISHED = publishedJson as unknown as GuidePublished;
