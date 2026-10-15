/**
 * The GP SDK testing guide, as shown on the Payroll tab and exported to .xlsx.
 *
 * guide.json is the source of truth. Edit it directly, or round-trip through a spreadsheet:
 *   npm run gp:guide:export -- guide.xlsx   then edit in Excel / Google Sheets, download as .xlsx
 *   npm run gp:guide:import -- guide.xlsx
 * Partner-facing: keep internal tickets and tracking out (the import and a unit test refuse them).
 */

import type { Guide } from "../../src/gp/guide/types";
import guideJson from "./guide.json";

export const GUIDE = guideJson as Guide;
