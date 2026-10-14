/**
 * GP capability report CLI, for local runs and CI.
 *
 *   npm run gp:capabilities -- [--scope baseline|all|custom] [--countries GBR,DEU]
 *                              [--env partners|sandbox] [--out data/gp-reports] [--strict]
 *
 * Uses .env credentials (CLIENT_ID/SECRET, plus COMPANY_SLUG/REFRESH_TOKEN for the entity check).
 * Writes <out>/gp-capabilities-{report.json, matrix.csv, test-cases.csv, report.md}.
 * With --strict, exits 1 when any baseline country drifts or errors. Use this as the CI gate.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { runGPCapabilities } from "./capability-runner";
import { toMarkdown, toMatrixCSV, toTestCasesCSV } from "./export";
import type { CountryCapability, GPScope } from "./types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "";
}

async function main() {
  const countries = arg("countries");
  const scope = (arg("scope") || (countries ? "custom" : "baseline")) as GPScope;
  const gatewayEnv = arg("env") || process.env.GATEWAY_ENV || "partners";
  const outDir = path.resolve(arg("out") || "data/gp-reports");
  const strict = process.argv.includes("--strict");

  let done = 0;
  let total = 0;
  const report = await runGPCapabilities(
    (event, data) => {
      if (event === "gp:collected") total = (data as { total: number }).total;
      if (event === "gp:country") {
        const c = data as CountryCapability;
        done++;
        const mark = c.baseline.verdict === "drift" ? "DRIFT" : c.baseline.verdict === "error" ? "ERROR" : "";
        process.stderr.write(`[${done}/${total}] ${c.code} ${c.coverage} ${mark}\n`);
      }
    },
    { scope, countryCodes: countries?.split(","), gatewayEnv }
  );

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "gp-capabilities-report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, "gp-capabilities-matrix.csv"), toMatrixCSV(report));
  fs.writeFileSync(path.join(outDir, "gp-capabilities-test-cases.csv"), toTestCasesCSV(report));
  fs.writeFileSync(path.join(outDir, "gp-capabilities-report.md"), toMarkdown(report));

  const s = report.summary;
  console.log(
    `\nGP capabilities (${report.gatewayEnv}, ${s.total} countries, ${(s.duration / 1000).toFixed(1)}s)\n` +
    `  coverage: ${s.full} full, ${s.employerOnly} employer only, ${s.employeeOnly} employee only, ${s.none} none, ${s.errors} errors\n` +
    `  baseline: ${s.match} match, ${s.drift} drift, ${s.noBaseline} no baseline\n` +
    `  written to ${outDir}`
  );

  const errored = report.countries.filter((c) => c.baseline.verdict === "error").length;
  if (strict && (s.drift > 0 || errored > 0)) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
