#!/usr/bin/env node
/**
 * env-sync: set up .env and check it. remote.sh is optional.
 *
 * For everyone:
 *   - creates .env from .env.example if it doesn't exist
 *   - generates JWT_SECRET if it's missing
 *   - checks each credential in .env against both gateways (read-only)
 *
 * If you also use remote.sh, it copies your client credentials and saved companies across,
 * so you don't have to paste them. Without remote.sh, fill in .env by hand; the rest still works.
 *
 *   npm run env:sync                       # set up / sync, then check every credential
 *   npm run env:sync -- --partners ACME --sandbox GP_HARNESS   # pick saved companies by label
 *   npm run env:sync -- --no-companies     # client credentials only (deployed-app setup)
 *   npm run env:sync -- --dry-run          # show what would change, write nothing
 *   npm run env:check                      # check the current .env without changing it
 *
 * Reads (the same files remote.sh uses; see the Notion page "remote.sh: Remote API toolkit"):
 *   ~/.remote_creds                SANDBOX_CLIENT_ID/SECRET, REMOTE_CLIENT_ID/SECRET (partners)
 *   ~/.remote_companies_partners   COMPANY_<LABEL>, REFRESH_<LABEL>   (written by create_company)
 *   ~/.remote_companies_sandbox    COMPANY_<LABEL>, REFRESH_<LABEL>
 *
 * Writes .env in place: managed keys are updated where they already are, missing ones are
 * appended, and every other line and comment is kept. The previous file is saved to .env.bak.
 *
 * The files are parsed, never executed. Secrets are never printed (only the first 4 characters).
 * Company refresh tokens go to .env for local Vitest/CLI runs only. Never put them in Vercel:
 * dashboard users connect their own company in the UI (see commit f4147e9).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import dotenv from "dotenv";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env");
const EXAMPLE_PATH = path.join(ROOT, ".env.example");
const HOME = os.homedir();

const CREDS_FILE = process.env.REMOTE_CREDS_FILE || path.join(HOME, ".remote_creds");
const COMPANIES_FILE = {
  partners: process.env.REMOTE_COMPANIES_PARTNERS || path.join(HOME, ".remote_companies_partners"),
  sandbox: process.env.REMOTE_COMPANIES_SANDBOX || path.join(HOME, ".remote_companies_sandbox"),
};

const GATEWAYS = {
  partners: process.env.REMOTE_GATEWAY_PARTNERS || "https://gateway.partners.remote-sandbox.com",
  sandbox: process.env.REMOTE_GATEWAY_SANDBOX || "https://gateway.remote-sandbox.com",
};

/** .env key names for each environment, matching src/client.ts */
const ENV_KEYS = {
  partners: { id: "CLIENT_ID", secret: "CLIENT_SECRET", company: "COMPANY_SLUG", refresh: "REFRESH_TOKEN" },
  sandbox: { id: "SANDBOX_CLIENT_ID", secret: "SANDBOX_CLIENT_SECRET", company: "SANDBOX_COMPANY_SLUG", refresh: "SANDBOX_REFRESH_TOKEN" },
};

/** remote.sh credential names for each environment */
const CREDS_KEYS = {
  partners: { id: "REMOTE_CLIENT_ID", secret: "REMOTE_CLIENT_SECRET" },
  sandbox: { id: "SANDBOX_CLIENT_ID", secret: "SANDBOX_CLIENT_SECRET" },
};

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
};

const CHECK_ONLY = flag("check-only");
const DRY_RUN = flag("dry-run");
const NO_CHECK = flag("no-check");
const NO_COMPANIES = flag("no-companies");
const PICK = { partners: opt("partners"), sandbox: opt("sandbox") };

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

const mask = (v) => (v ? `${String(v).slice(0, 4)}… (${String(v).length} chars)` : "(empty)");

const isPlaceholder = (v) => !v || /^your[_-]/i.test(v) || v === "..." || v === "change-me";

/**
 * Parse a shell file of `export KEY='value'`, `KEY="value"` and `KEY=value` lines, with shell
 * quoting rules. Later lines win, like `source`. Used for ~/.remote_creds and ~/.remote_companies_*.
 */
function parseShellExports(text) {
  const out = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const rest = m[2].trim();
    let value = "";
    if (rest.startsWith("'")) {
      const end = rest.indexOf("'", 1);
      value = rest.slice(1, end === -1 ? undefined : end);
    } else if (rest.startsWith('"')) {
      for (let i = 1; i < rest.length; i++) {
        const ch = rest[i];
        if (ch === "\\" && i + 1 < rest.length && `"\\$\``.includes(rest[i + 1])) {
          value += rest[++i];
        } else if (ch === '"') {
          break;
        } else {
          value += ch;
        }
      }
    } else {
      value = rest.replace(/\s+#.*$/, "");
    }
    out.set(m[1], value);
  }
  return out;
}

/** Parse .env with dotenv itself, so values match exactly what the app reads */
function parseDotenv(text) {
  return new Map(Object.entries(dotenv.parse(text)));
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

/** Saved companies from ~/.remote_companies_<env>, in the order they were created */
function loadCompanies(env) {
  const text = readIfExists(COMPANIES_FILE[env]);
  if (!text) return [];
  const vars = parseShellExports(text);
  const order = [];
  for (const key of vars.keys()) {
    const m = key.match(/^COMPANY_(.+)$/);
    if (m && !order.includes(m[1])) order.push(m[1]);
  }
  return order
    .map((label) => ({ label, id: vars.get(`COMPANY_${label}`), refresh: vars.get(`REFRESH_${label}`) }))
    .filter((co) => co.id && co.refresh);
}

async function chooseCompany(env, companies, current) {
  if (companies.length === 0) return null;
  const wanted = PICK[env];
  if (wanted) {
    const hit = companies.find((co) => co.label.toLowerCase() === wanted.toLowerCase());
    if (!hit) {
      throw new Error(`No company labelled ${wanted} in ${COMPANIES_FILE[env]}. Saved: ${companies.map((co) => co.label).join(", ")}`);
    }
    return hit;
  }
  const kept = companies.find((co) => co.id === current);
  if (kept) return kept;
  if (companies.length === 1) return companies[0];

  if (process.stdin.isTTY && !DRY_RUN) {
    console.log(`\n${env}: ${companies.length} saved companies in ${COMPANIES_FILE[env]}`);
    companies.forEach((co, i) => console.log(`  ${i + 1}) ${co.label}  ${c.dim(co.id)}`));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Use which for ${env}? [${companies.length}] `);
    rl.close();
    const n = Number(answer.trim() || companies.length);
    if (Number.isInteger(n) && n >= 1 && n <= companies.length) return companies[n - 1];
    throw new Error(`Invalid choice: ${answer}`);
  }
  const last = companies[companies.length - 1];
  console.log(c.warn(`${env}: ${companies.length} saved companies; using the newest (${last.label}). Pass --${env} <LABEL> to choose.`));
  return last;
}

/** Update KEY=value lines in place, append missing keys, keep everything else */
function applyToEnvText(text, updates) {
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  const changes = [];
  const result = lines.map((line) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!m || !(m[1] in updates)) return line;
    const key = m[1];
    if (seen.has(key)) {
      changes.push({ key, action: "removed duplicate" });
      return null;
    }
    seen.add(key);
    const oldValue = parseDotenv(line).get(key);
    if (oldValue === updates[key]) return line;
    changes.push({ key, action: isPlaceholder(oldValue) ? "set" : "updated" });
    return `${key}=${quote(updates[key])}`;
  }).filter((l) => l !== null);

  const missing = Object.keys(updates).filter((k) => !seen.has(k));
  if (missing.length) {
    if (result[result.length - 1] !== "") result.push("");
    result.push("# ── Added by npm run env:sync ──────────────────────────");
    for (const key of missing) {
      result.push(`${key}=${quote(updates[key])}`);
      changes.push({ key, action: "added" });
    }
    result.push("");
  }
  return { text: result.join("\n"), changes };
}

/**
 * Quote a value the way dotenv reads it back literally: bare when safe, otherwise single
 * quotes, then double quotes, then backticks (dotenv does not process backslash escapes).
 */
function quote(v) {
  if (/^[A-Za-z0-9_./:@+=,-]*$/.test(v)) return v;
  if (!v.includes("'")) return `'${v}'`;
  if (!v.includes('"')) return `"${v}"`;
  if (!v.includes("`")) return `\`${v}\``;
  throw new Error("A value contains ', \" and ` together, so it can't be written to .env safely");
}

// ---------------------------------------------------------------------------
// API checks (read-only)
// ---------------------------------------------------------------------------

async function tokenRequest(env, id, secret, body) {
  const res = await fetch(`${GATEWAYS[env]}/auth/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && !!data.access_token, status: res.status, data };
}

async function checkEnv(env, vars) {
  const k = ENV_KEYS[env];
  const id = vars.get(k.id);
  const secret = vars.get(k.secret);
  const company = vars.get(k.company);
  const refresh = vars.get(k.refresh);
  const lines = [];
  let pass = true;

  if (isPlaceholder(id) || isPlaceholder(secret)) {
    lines.push(c.warn(`  – client credentials not set (${k.id}, ${k.secret})`));
    return { pass: false, lines };
  }
  try {
    const cc = await tokenRequest(env, id, secret, { grant_type: "client_credentials" });
    if (cc.ok) lines.push(c.ok(`  ✓ client credentials (${mask(id)})`));
    else {
      pass = false;
      lines.push(c.bad(`  ✗ client credentials rejected (HTTP ${cc.status}: ${cc.data.error || "unknown"})`));
    }

    if (isPlaceholder(company) || isPlaceholder(refresh)) {
      lines.push(c.dim(`  – no company in .env (${k.company}, ${k.refresh}); only needed for npm test and the CLI`));
      return { pass, lines };
    }
    const rt = await tokenRequest(env, id, secret, { grant_type: "refresh_token", refresh_token: refresh });
    if (!rt.ok) {
      pass = false;
      const hint = rt.data.error === "invalid_refresh_token" || rt.data.error === "invalid_grant"
        ? " (expired, revoked, or issued to different client credentials)"
        : "";
      lines.push(c.bad(`  ✗ company refresh token rejected (HTTP ${rt.status}: ${rt.data.error || "unknown"})${hint}`));
      return { pass, lines };
    }
    const res = await fetch(`${GATEWAYS[env]}/v1/companies/${encodeURIComponent(company)}`, {
      headers: { Authorization: `Bearer ${rt.data.access_token}` },
    });
    const body = await res.json().catch(() => ({}));
    const co = body?.data?.company || body?.data || {};
    if (res.ok) {
      lines.push(c.ok(`  ✓ company "${co.name || company}" (${co.status || "status unknown"}) ${c.dim(company)}`));
    } else {
      pass = false;
      lines.push(c.bad(`  ✗ refresh token works but GET /v1/companies/${company} returned ${res.status}; the company ID may not match the token`));
    }
  } catch (err) {
    pass = false;
    lines.push(c.bad(`  ✗ could not reach ${GATEWAYS[env]}: ${err.message}`));
  }
  return { pass, lines };
}

async function runChecks(envText) {
  const vars = parseDotenv(envText);
  console.log("\nChecking credentials against the API (read-only):");
  let allPass = true;
  for (const env of ["partners", "sandbox"]) {
    const { pass, lines } = await checkEnv(env, vars);
    console.log(`${env} ${c.dim(GATEWAYS[env])}`);
    lines.forEach((l) => console.log(l));
    allPass &&= pass;
  }
  for (const key of ["JWT_SECRET", "AUTH_PASSWORD"]) {
    if (isPlaceholder(vars.get(key))) {
      allPass = false;
      console.log(c.warn(`  – ${key} is not set; the dashboard needs it`));
    }
  }
  return allPass;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  let envText = readIfExists(ENV_PATH);

  if (CHECK_ONLY) {
    if (envText === null) throw new Error(".env not found. Run npm run env:sync first.");
    process.exit((await runChecks(envText)) ? 0 : 1);
  }

  if (envText === null) {
    envText = readIfExists(EXAMPLE_PATH) || "";
    console.log(c.dim(".env not found; starting from .env.example"));
  }
  const current = parseDotenv(envText);

  // remote.sh is optional: use its files only if they exist
  const credsText = readIfExists(CREDS_FILE);
  const hasCompanyFiles = Object.values(COMPANIES_FILE).some((f) => fs.existsSync(f));
  const usingRemoteSh = credsText !== null || hasCompanyFiles;
  const creds = credsText ? parseShellExports(credsText) : new Map();

  const updates = {};
  const summary = [];

  if (!usingRemoteSh) {
    summary.push(c.dim("remote.sh not set up (optional): nothing to import, using .env as it is"));
  }

  for (const env of ["partners", "sandbox"]) {
    const ek = ENV_KEYS[env];
    const ck = CREDS_KEYS[env];
    const id = creds.get(ck.id);
    const secret = creds.get(ck.secret);
    if (!isPlaceholder(id) && !isPlaceholder(secret)) {
      updates[ek.id] = id;
      updates[ek.secret] = secret;
      summary.push(`${env}: client credentials from remote.sh ${ck.id}/${ck.secret} (${mask(id)})`);
    } else if (isPlaceholder(current.get(ek.id)) || isPlaceholder(current.get(ek.secret))) {
      summary.push(c.warn(`${env}: fill in ${ek.id} and ${ek.secret} in .env`));
    }

    if (!NO_COMPANIES && usingRemoteSh) {
      const companies = loadCompanies(env);
      const pick = await chooseCompany(env, companies, current.get(ek.company));
      if (pick) {
        updates[ek.company] = pick.id;
        updates[ek.refresh] = pick.refresh;
        summary.push(`${env}: company ${pick.label} ${c.dim(pick.id)}`);
      } else {
        summary.push(c.dim(`${env}: no saved remote.sh companies (optional; only npm test and the GP CLI use one)`));
      }
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value.includes("$")) {
      summary.push(c.warn(`${key} contains "$". Next.js expands $NAME in .env values, so the dashboard may read it wrong`));
    }
  }

  if (isPlaceholder(current.get("JWT_SECRET"))) {
    updates.JWT_SECRET = crypto.randomBytes(32).toString("base64");
    summary.push("JWT_SECRET: generated a random value");
  }
  if (isPlaceholder(current.get("AUTH_PASSWORD"))) {
    summary.push(c.warn("AUTH_PASSWORD is not set; add one for the dashboard login"));
  }

  const { text, changes } = applyToEnvText(envText, updates);

  console.log("\nSetup:");
  summary.forEach((s) => console.log(`  ${s}`));
  console.log("\nChanges to .env:");
  if (changes.length === 0) console.log(c.dim("  none: .env is already in sync"));
  changes.forEach((ch) => console.log(`  ${ch.action.padEnd(17)} ${ch.key}`));

  if (DRY_RUN) {
    console.log(c.dim("\n--dry-run: nothing written"));
  } else if (changes.length > 0) {
    const hadEnv = fs.existsSync(ENV_PATH);
    if (hadEnv) {
      fs.copyFileSync(ENV_PATH, `${ENV_PATH}.bak`);
      fs.chmodSync(`${ENV_PATH}.bak`, 0o600);
    }
    fs.writeFileSync(ENV_PATH, text, { mode: 0o600 });
    fs.chmodSync(ENV_PATH, 0o600);
    console.log(c.dim(hadEnv ? "\nWrote .env (previous copy in .env.bak)" : "\nCreated .env"));
  }

  if (!NO_CHECK) {
    const ok = await runChecks(DRY_RUN ? text : readIfExists(ENV_PATH) ?? text);
    process.exit(ok ? 0 : 1);
  }
}

main().catch((err) => {
  console.error(c.bad(`env-sync: ${err.message}`));
  process.exit(1);
});
