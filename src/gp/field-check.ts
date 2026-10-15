/**
 * Skipped-field check (sandbox only, writes to a test employee).
 *
 * A "skipped" field is one the form never asks for: the schema requires it only under an
 * `if: false` rule, so a client that follows the schema leaves it out. The question is whether
 * the API still requires it (the UK overtime_eligible 422) or not (UK tax_code / wm_indicator).
 *
 * The check:
 *   1. GET /v1/countries/{cc}/{form}?employment_id={id}   the form as this employee sees it
 *   2. Fill every field the form requires with a test value, leaving the skipped fields out
 *   3. PUT the form to the test employee, with the same body shape as remote-flows 1.59.0:
 *        PUT /v2/employments/{id}/contract-details        { contract_details: {...} }
 *        PUT /v2/employments/{id}/administrative-details  { administrative_details: {...} }
 *   4. 2xx: not enforced. 422 naming a skipped field: enforced. 422 naming other fields: inconclusive.
 *
 * Only required fields are filled, and "no" is preferred for choices, so the payload stays
 * minimal and doesn't switch on extra conditional sections.
 */

import type { ApiResponse, RemoteClient } from "../client";
import { GP_FORMS, type GPFormKey } from "../../data/gp-capability-baseline";
import { analyzeSchema, unwrapSchema } from "./schema-analysis";
import type { FieldCheckOutcome, FieldCheckResult } from "./types";

type Json = Record<string, unknown>;

/** Employer forms the check can submit, with their endpoint and body envelope (from remote-flows 1.59.0) */
export const CHECKABLE_FORMS: Partial<Record<GPFormKey, { path: (employmentId: string) => string; envelope: string }>> = {
  contract_details: { path: (id) => `/v2/employments/${encodeURIComponent(id)}/contract-details`, envelope: "contract_details" },
  administrative_details: { path: (id) => `/v2/employments/${encodeURIComponent(id)}/administrative-details`, envelope: "administrative_details" },
};

export const isCheckableForm = (key: string): key is GPFormKey => key in CHECKABLE_FORMS;

const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

function typesOf(prop: Json): string[] {
  const t = prop.type;
  return (Array.isArray(t) ? t : t ? [t] : []).filter((x): x is string => typeof x === "string");
}

/** Fixed choices of a property (oneOf/anyOf const, or enum), without null */
function choices(prop: Json): unknown[] {
  const out: unknown[] = [];
  for (const k of ["oneOf", "anyOf"]) {
    const arr = prop[k];
    if (Array.isArray(arr)) for (const o of arr) if (isObj(o) && "const" in o && o.const !== null) out.push(o.const);
  }
  if (Array.isArray(prop.enum)) for (const v of prop.enum) if (v !== null) out.push(v);
  return out;
}

/** Prefer "no" so the payload doesn't open extra conditional sections; otherwise the first choice */
function pick(opts: unknown[]): unknown {
  return opts.find((o) => typeof o === "string" && o.toLowerCase() === "no") ?? opts[0];
}

function futureDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Plausible address values, so address checks don't fail on the test data itself */
const SAMPLE_ADDRESS: Record<string, { postal_code: string; city: string; state?: string }> = {
  GBR: { postal_code: "SW1A 1AA", city: "London" },
  USA: { postal_code: "10001", city: "New York", state: "NY" },
  CAN: { postal_code: "M5V 2T6", city: "Toronto", state: "ON" },
  MEX: { postal_code: "06600", city: "Ciudad de Mexico" },
  SWE: { postal_code: "111 22", city: "Stockholm" },
  DEU: { postal_code: "10115", city: "Berlin" },
  FRA: { postal_code: "75001", city: "Paris" },
  ESP: { postal_code: "28001", city: "Madrid" },
  NLD: { postal_code: "1011 AB", city: "Amsterdam" },
  IRL: { postal_code: "D02 X285", city: "Dublin" },
  AUS: { postal_code: "2000", city: "Sydney", state: "NSW" },
};

function namedSample(field: string, country?: string): string | undefined {
  const sample = country ? SAMPLE_ADDRESS[country] : undefined;
  if (/^(postal_code|postcode|zip(_code)?)$/.test(field)) return sample?.postal_code;
  if (/^city$/.test(field)) return sample?.city;
  if (/^(address|address_line_1|street)$/.test(field)) return "1 Test Street";
  return undefined;
}

/** Values tried, in order, against a string field's `pattern` */
const PATTERN_CANDIDATES = [
  "Test value", "1234567890", "123456789", "12345678", "1234567", "123456", "12345", "1234", "123",
  "AB123456C", "QQ123456C", "1257L", "BR", "ABC123", "A1B2C3D4E5F6", "SW1A 1AA", "12345-678",
  "+441234567890", "GB82WEST12345698765432", "DE89370400440532013000", "2026-01-01",
];

function stringValue(prop: Json, path: string, unsure: string[], country?: string): string {
  const format = prop.format;
  const sample = namedSample(path.split(".").pop()!.replace("[]", ""), country);
  if (sample) return sample;
  if (format === "date") return futureDate(30);
  if (format === "date-time") return new Date(Date.now() + 30 * 86_400_000).toISOString();
  if (format === "email") return "gp-test@example.com";
  if (format === "uri" || format === "url") return "https://example.com";

  if (typeof prop.pattern === "string") {
    let re: RegExp | null = null;
    try {
      re = new RegExp(prop.pattern);
    } catch {
      re = null;
    }
    const hit = re ? PATTERN_CANDIDATES.find((c) => re!.test(c)) : undefined;
    if (hit) return hit;
    unsure.push(path);
  }

  let s = "Test value";
  const min = typeof prop.minLength === "number" ? prop.minLength : 0;
  while (s.length < min) s += " test value";
  if (typeof prop.maxLength === "number") s = s.slice(0, Math.max(prop.maxLength, 1));
  return s;
}

/** Realistic numbers by field name, so full-time contracts don't get 1 hour a week */
const NAMED_NUMBERS: [RegExp, number][] = [
  [/hours_per_week$/, 40],
  [/hours_per_day$/, 8],
  [/days_per_week$/, 5],
];

function numberValue(prop: Json, integer: boolean, path = ""): number {
  if (typeof prop.default === "number") return prop.default;
  const field = path.split(".").pop() || "";
  const named = NAMED_NUMBERS.find(([re]) => re.test(field));
  if (named) {
    let v = named[1];
    if (typeof prop.maximum === "number") v = Math.min(v, prop.maximum);
    if (typeof prop.minimum === "number") v = Math.max(v, prop.minimum);
    return v;
  }
  const presentation = isObj(prop["x-jsf-presentation"]) ? (prop["x-jsf-presentation"] as Json) : {};
  let n: number =
    typeof prop.minimum === "number" && prop.minimum > 0 ? prop.minimum
    : typeof prop.exclusiveMinimum === "number" ? prop.exclusiveMinimum + 1
    : presentation.inputType === "money" ? 100000
    : 1;
  if (n <= 0) n = 1;
  if (typeof prop.maximum === "number") n = Math.min(n, prop.maximum);
  return integer ? Math.ceil(n) : n;
}

/** A test value for one property; undefined when the property is forbidden (`false`) */
function valueFor(prop: unknown, path: string, omit: Set<string>, unsure: string[], depth: number, country?: string): unknown {
  if (prop === false) return undefined;
  if (!isObj(prop)) return "Test value";
  if ("const" in prop && prop.const !== null) return prop.const;
  if (typeof prop.default === "string" && prop.default !== "") return prop.default;

  const opts = choices(prop);
  if (opts.length) return pick(opts);

  const types = typesOf(prop).filter((t) => t !== "null");
  if (types.includes("array")) {
    const items = isObj(prop.items) ? prop.items : {};
    const itemOpts = choices(items);
    const count = Math.max(typeof prop.minItems === "number" ? prop.minItems : 1, 1);
    if (itemOpts.length) return itemOpts.slice(0, count).length >= count ? itemOpts.slice(0, count) : Array(count).fill(pick(itemOpts));
    if (typesOf(items).includes("object") || isObj(items.properties)) {
      return Array.from({ length: count }, () => fillForm(items, omit, `${path}[]`, unsure, depth + 1, country));
    }
    return Array(count).fill(valueFor(items, `${path}[]`, omit, unsure, depth + 1, country));
  }
  if (types.includes("object") || isObj(prop.properties)) return fillForm(prop, omit, path, unsure, depth + 1, country);
  if (types.includes("boolean")) return false;
  if (types.includes("integer")) return numberValue(prop, true, path);
  if (types.includes("number")) return numberValue(prop, false, path);
  return stringValue(prop, path, unsure, country);
}

/** Does a JSON Schema `if` clause hold for these values? Conservative on anything unfamiliar. */
function holds(cond: unknown, values: Json): boolean {
  if (cond === true) return true;
  if (cond === false || !isObj(cond)) return false;
  if (Array.isArray(cond.required) && !cond.required.every((k) => typeof k === "string" && values[k] !== undefined)) return false;
  if (isObj(cond.properties)) {
    for (const [k, sub] of Object.entries(cond.properties)) {
      const v = values[k];
      if (sub === false) {
        if (v !== undefined) return false;
        continue;
      }
      if (!isObj(sub) || v === undefined) continue; // `properties` only constrains present values
      if ("const" in sub && v !== sub.const) return false;
      if (Array.isArray(sub.enum) && !sub.enum.includes(v)) return false;
      if (isObj(sub.not) && "const" in sub.not && v === sub.not.const) return false;
      if (isObj(sub.contains) && Array.isArray(v) && "const" in sub.contains && !v.includes(sub.contains.const)) return false;
    }
  }
  if (Array.isArray(cond.allOf) && !cond.allOf.every((c) => holds(c, values))) return false;
  if (Array.isArray(cond.anyOf) && !cond.anyOf.some((c) => holds(c, values))) return false;
  return true;
}

/** if/then/else rules directly on a node, plus those in its allOf/anyOf/oneOf */
function rulesOf(node: Json): Json[] {
  const out: Json[] = [];
  if ("if" in node) out.push(node);
  for (const k of ["allOf", "anyOf", "oneOf"]) {
    const arr = node[k];
    if (Array.isArray(arr)) for (const e of arr) if (isObj(e) && "if" in e) out.push(e);
  }
  return out;
}

/** Required fields and property overrides from the branches that apply to these values */
function activeBranches(node: Json, values: Json, depth = 0): { required: string[]; props: Json } {
  const required: string[] = [];
  const props: Json = {};
  if (depth > 4) return { required, props };
  for (const rule of rulesOf(node)) {
    const branch = holds(rule.if, values) ? rule.then : rule.else;
    if (!isObj(branch)) continue;
    if (Array.isArray(branch.required)) for (const f of branch.required) if (typeof f === "string") required.push(f);
    if (isObj(branch.properties)) Object.assign(props, branch.properties);
    const inner = activeBranches(branch, values, depth + 1);
    required.push(...inner.required);
    Object.assign(props, inner.props);
  }
  return { required, props };
}

/**
 * Fill the fields a form requires (including those required by rules that apply to the values
 * chosen), with test values. Fields in `omit` are never sent. Returns the values; fields whose
 * pattern no test value could satisfy are added to `unsure`.
 */
export function fillForm(schema: Json, omit: Set<string>, prefix = "", unsure: string[] = [], depth = 0, country?: string): Json {
  const values: Json = {};
  if (depth > 4) return values;
  const baseProps = isObj(schema.properties) ? schema.properties : {};
  const join = (f: string) => (prefix ? `${prefix}.${f}` : f);

  let required = new Set<string>(Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === "string") : []);
  for (let pass = 0; pass < 6; pass++) {
    const { required: extra, props: overrides } = activeBranches(schema, values);
    extra.forEach((f) => required.add(f));
    let added = false;
    for (const field of required) {
      if (field in values || omit.has(join(field)) || omit.has(field)) continue;
      const base = baseProps[field];
      const override = overrides[field];
      const prop = override === false ? false : isObj(base) && isObj(override) ? { ...base, ...override } : (override ?? base);
      const v = valueFor(prop, join(field), omit, unsure, depth, country);
      if (v !== undefined) {
        values[field] = v;
        added = true;
      }
    }
    // Branches can change once new values exist; stop when nothing new is required
    const next = new Set([...required, ...activeBranches(schema, values).required]);
    if (!added && next.size === required.size) break;
    required = next;
  }
  return values;
}

export function buildFormPayload(schema: Json, omit: string[], country?: string): { values: Json; unsure: string[] } {
  const unsure: string[] = [];
  const values = fillForm(schema, new Set(omit), "", unsure, 0, country?.toUpperCase());
  return { values, unsure };
}

/** Field names an error body points at: keys whose values are error message lists, at any depth */
export function rejectedFields(data: unknown, envelope?: string): string[] {
  const out = new Set<string>();
  const walk = (node: unknown, key: string | null, depth: number) => {
    if (depth > 6 || node == null) return;
    if (Array.isArray(node)) {
      if (key && node.length && node.every((x) => typeof x === "string")) out.add(key);
      else node.forEach((x) => walk(x, key, depth + 1));
      return;
    }
    if (isObj(node)) {
      for (const [k, v] of Object.entries(node)) walk(v, k, depth + 1);
      return;
    }
    if (typeof node === "string" && key && !["message", "error", "code", "status", "detail", "type", "title"].includes(key)) out.add(key);
  };
  if (isObj(data)) walk(data.errors ?? data, null, 0);
  ["errors", "message", envelope].forEach((k) => k && out.delete(k));
  return [...out];
}

function messageOf(data: unknown): string {
  if (!isObj(data)) return "";
  const parts = [typeof data.message === "string" ? data.message : "", data.errors ? JSON.stringify(data.errors) : ""];
  return parts.filter(Boolean).join(" ").slice(0, 500);
}

export function interpretSubmit(
  status: number,
  data: unknown,
  skipped: string[],
  envelope?: string
): { outcome: FieldCheckOutcome; enforcedFields: string[]; otherRejected: string[]; message: string } {
  const message = messageOf(data);
  if (status >= 200 && status < 300) return { outcome: "not_enforced", enforcedFields: [], otherRejected: [], message };

  if (status === 422 || status === 400) {
    const rejected = rejectedFields(data, envelope);
    const leaf = (f: string) => f.split(".").pop()!;
    const named = (f: string) => rejected.includes(f) || rejected.includes(leaf(f)) || new RegExp(`\\b${leaf(f)}\\b`).test(message);
    const enforcedFields = skipped.filter(named);
    const skippedLeaves = new Set(skipped.map(leaf));
    const otherRejected = rejected.filter((f) => !skippedLeaves.has(f) && !skipped.includes(f));
    return { outcome: enforcedFields.length ? "enforced" : "inconclusive", enforcedFields, otherRejected, message };
  }
  return { outcome: "error", enforcedFields: [], otherRejected: [], message: message || `HTTP ${status}` };
}

/** Run the check for one country, form and test employee */
export async function checkSkippedFields(
  client: RemoteClient,
  countryCode: string,
  formKey: GPFormKey,
  employmentId: string
): Promise<FieldCheckResult> {
  const code = countryCode.toUpperCase();
  const target = CHECKABLE_FORMS[formKey];
  const def = GP_FORMS.find((f) => f.key === formKey);
  const base = {
    countryCode: code, form: formKey, employmentId, checkedAt: new Date().toISOString(), source: "live" as const,
    skippedFields: [] as string[], enforcedFields: [] as string[], otherRejected: [] as string[], sentFields: [] as string[],
  };
  if (!target || !def) return { ...base, outcome: "error", message: `${formKey} can't be checked` };

  const schemaRes = await client.get(`/v1/countries/${encodeURIComponent(code)}/${def.form}?employment_id=${encodeURIComponent(employmentId)}`);
  if (schemaRes.status !== 200) {
    return { ...base, outcome: "error", httpStatus: schemaRes.status, requestId: schemaRes.requestId, message: `Reading the form failed: ${messageOf(schemaRes.data) || `HTTP ${schemaRes.status}`}` };
  }
  const schema = unwrapSchema(schemaRes.data);
  if (!schema) return { ...base, outcome: "error", message: "The form response had no schema" };

  const skipped = analyzeSchema(schema).inertRequired;
  if (skipped.length === 0) {
    return { ...base, outcome: "nothing_to_check", message: "This employee's version of the form doesn't skip any required fields" };
  }

  const { values, unsure } = buildFormPayload(schema, skipped, code);
  const res: ApiResponse<unknown> = await client.put(target.path(employmentId), { [target.envelope]: values });
  const verdict = interpretSubmit(res.status, res.data, skipped, target.envelope);
  const unsureNote = unsure.length && verdict.outcome === "inconclusive" ? ` No test value matched the pattern for: ${unsure.join(", ")}.` : "";

  return {
    ...base,
    skippedFields: skipped,
    sentFields: Object.keys(values),
    outcome: verdict.outcome,
    enforcedFields: verdict.enforcedFields,
    otherRejected: verdict.otherRejected,
    httpStatus: res.status,
    requestId: res.requestId,
    message: (verdict.message + unsureNote).trim() || undefined,
  };
}
