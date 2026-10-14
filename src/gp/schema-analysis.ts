/**
 * Static analysis of a GP JSON schema form.
 *
 * Pure functions with no network calls, so they can be unit tested.
 *
 * Why look for hidden and inert-required fields? In the GBR contract details
 * case (API-BEHAVIOUR-2 / TASA-1667), the form hid `overtime_eligible` and only
 * required it under `{ if: false, then: { required: [...] } }`, but the backend
 * still returned 422 "can't be blank". Fields that match this pattern are worth
 * checking whenever a partner reports a 422 on a form that "has no such field".
 */

import type { SchemaAnalysis } from "./types";

type Json = Record<string, unknown>;

const MAX_DEPTH = 4;

function isObj(v: unknown): v is Json {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Unwrap the API envelope: { data: { schema } } | { data: schema } | schema */
export function unwrapSchema(payload: unknown): Json | null {
  if (!isObj(payload)) return null;
  const data = isObj(payload.data) ? payload.data : payload;
  if (isObj(data.schema)) return data.schema;
  if (isObj(data.properties) || Array.isArray(data.required)) return data;
  return null;
}

function presentation(prop: Json): Json | undefined {
  const p = prop["x-jsf-presentation"] ?? prop.presentation;
  return isObj(p) ? p : undefined;
}

function isHidden(prop: Json): boolean {
  const pres = presentation(prop);
  return pres?.inputType === "hidden" || prop["x-jsf-hidden"] === true;
}

function join(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

/** Collect if/then rules from a schema node: top-level plus allOf/anyOf/oneOf entries */
function collectConditionals(node: Json): Json[] {
  const rules: Json[] = [];
  if ("if" in node) rules.push(node);
  for (const k of ["allOf", "anyOf", "oneOf"]) {
    const arr = node[k];
    if (Array.isArray(arr)) {
      for (const entry of arr) if (isObj(entry) && "if" in entry) rules.push(entry);
    }
  }
  return rules;
}

function requiredOf(node: unknown): string[] {
  if (!isObj(node) || !Array.isArray(node.required)) return [];
  return node.required.filter((r): r is string => typeof r === "string");
}

function walk(
  node: Json,
  prefix: string,
  depth: number,
  out: { hidden: Set<string>; inert: Set<string>; conditional: Set<string> }
): void {
  if (depth > MAX_DEPTH) return;

  for (const rule of collectConditionals(node)) {
    const thenReq = requiredOf(rule.then);
    const elseReq = requiredOf(rule.else);
    if (rule.if === false) {
      thenReq.forEach((f) => out.inert.add(join(prefix, f)));
      elseReq.forEach((f) => out.conditional.add(join(prefix, f)));
    } else if (rule.if === true) {
      thenReq.forEach((f) => out.conditional.add(join(prefix, f)));
      elseReq.forEach((f) => out.inert.add(join(prefix, f)));
    } else {
      thenReq.forEach((f) => out.conditional.add(join(prefix, f)));
      elseReq.forEach((f) => out.conditional.add(join(prefix, f)));
    }
  }

  const props = isObj(node.properties) ? node.properties : {};
  for (const [key, raw] of Object.entries(props)) {
    if (!isObj(raw)) continue;
    const path = join(prefix, key);
    if (isHidden(raw)) out.hidden.add(path);
    if (isObj(raw.properties) || collectConditionals(raw).length > 0) {
      walk(raw, path, depth + 1, out);
    }
  }
}

export function analyzeSchema(schema: Json): SchemaAnalysis {
  const props = isObj(schema.properties) ? schema.properties : {};
  const out = { hidden: new Set<string>(), inert: new Set<string>(), conditional: new Set<string>() };
  walk(schema, "", 0, out);

  // A field that is also required for real somewhere is not "inert-only"
  const topRequired = requiredOf(schema);
  for (const f of topRequired) out.inert.delete(f);
  for (const f of out.conditional) out.inert.delete(f);

  return {
    fieldCount: Object.keys(props).length,
    requiredFields: topRequired,
    hiddenFields: [...out.hidden].sort(),
    inertRequired: [...out.inert].sort(),
    conditionalRequired: [...out.conditional].sort(),
  };
}

/** Field names that mean "full name" in personal details */
const NAME_FIELDS = ["name", "full_name"];

export function isNameRequired(analysis: SchemaAnalysis | undefined): boolean | null {
  if (!analysis) return null;
  return analysis.requiredFields.some((f) => NAME_FIELDS.includes(f));
}
