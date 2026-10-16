/**
 * Functional checks for the testing guide: which error code and message Remote returns, and when
 * a step is blocked (sandbox only; creates GP test employees and saves forms to them).
 *
 * Each check is a short scenario. Every step is observed (status, message, field names, blocked or
 * not) and compared with data/gp-guide/functional-expectations.ts:
 *   all listed steps match        -> as_recorded
 *   a listed step doesn't match   -> differs
 *   a step with no expectation    -> observed (new behaviour for a person to review and record)
 *   a setup step failed, or a 5xx -> error
 *
 * Scenarios that change an employee's state (save, invite) get a fresh test employee each, so
 * every run starts from the same place. A full run creates about nine GP test employees in GBR
 * (A17 may create a second one with a reused email; A16 may add a legal entity without GP).
 */

import type { ApiResponse, RemoteClient } from "../../client";
import { getCompanyEntities } from "../../setup/entity-swap";
import { GP_FORMS, type GPFormKey } from "../../../data/gp-capability-baseline";
import { FUNCTIONAL_EXPECTATIONS, type StepExpectation } from "../../../data/gp-guide/functional-expectations";
import { summarizeEntities } from "../evaluate";
import { CHECKABLE_FORMS, buildFormPayload, rejectedFields } from "../field-check";
import { analyzeSchema, unwrapSchema } from "../schema-analysis";
import { buildBasicInformation, createGPTestEmployee } from "../test-employee";
import type { GuideCheckContext, GuideCheckOutcome, GuideCheckResult } from "./checks";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** Country the flow scenarios run in: its forms are known to save with the test values */
export const FLOW_COUNTRY = "GBR";
/** Country used for a legal entity with GP switched off, when the company has none */
export const NON_GP_COUNTRY = "NLD";

export interface StepObservation {
  key: string;
  label: string;
  status: number;
  /** Refused by Remote (4xx) */
  blocked: boolean;
  message: string;
  fields: string[];
  requestId?: string;
  /** The field a negative test changed or left out */
  target?: string;
}

export type StepVerdict = "match" | "mismatch" | "new" | "server_error";

function apiMessage(res: ApiResponse<unknown>): string {
  const d = res.data;
  if (isObj(d)) {
    const parts = [typeof d.message === "string" ? d.message : "", d.errors ? JSON.stringify(d.errors) : ""].filter(Boolean);
    if (parts.length) return parts.join(" ").slice(0, 400);
  }
  return (res.rawText || "").slice(0, 400);
}

function observation(key: string, label: string, res: ApiResponse<unknown>, envelope?: string, target?: string): StepObservation {
  return {
    key,
    label,
    status: res.status,
    blocked: res.status >= 400 && res.status < 500,
    message: res.status >= 400 ? apiMessage(res) : "",
    fields: res.status >= 400 ? rejectedFields(res.data, envelope) : [],
    requestId: res.requestId,
    target,
  };
}

/** The expectation for a step: the case's own, else a shared setup one */
export function expectationFor(caseId: string, key: string): StepExpectation | undefined {
  return FUNCTIONAL_EXPECTATIONS[caseId]?.[key] ?? FUNCTIONAL_EXPECTATIONS._setup?.[key];
}

export function judge(obs: StepObservation, exp: StepExpectation | undefined): StepVerdict {
  if (obs.status >= 500) return "server_error";
  if (!exp) return "new";
  if (exp.blocked !== obs.blocked) return "mismatch";
  if (exp.status && !exp.status.includes(obs.status)) return "mismatch";
  if (exp.message && !obs.message.toLowerCase().includes(exp.message.toLowerCase())) return "mismatch";
  if (exp.fields) {
    const want = exp.fields.map((f) => (f === "$omitted" ? obs.target ?? "" : f)).filter(Boolean);
    const leaf = (f: string) => f.split(".").pop()!;
    const named = (f: string) => obs.fields.includes(f) || obs.fields.includes(leaf(f)) || new RegExp(`\\b${leaf(f)}\\b`).test(obs.message);
    if (!want.every(named)) return "mismatch";
  }
  return "match";
}

function describe(obs: StepObservation, verdict: StepVerdict, exp?: StepExpectation): string {
  const what = obs.blocked ? `refused (${obs.status})` : obs.status >= 500 ? `server error (${obs.status})` : `accepted (${obs.status})`;
  const msg = obs.message ? `: ${obs.message}` : "";
  const flag =
    verdict === "match" ? " · as expected"
    : verdict === "mismatch" ? ` · expected it to be ${exp?.blocked ? "refused" : "accepted"}${exp?.status ? ` with ${exp.status.join("/")}` : ""}${exp?.message ? ` ("${exp.message}")` : ""}${exp?.fields ? `, naming ${exp.fields.map((f) => (f === "$omitted" ? obs.target : f)).join(", ")}` : ""}`
    : verdict === "new" ? " · new, not yet recorded"
    : "";
  return `${obs.label}: ${what}${msg}${flag}`;
}

/** Collects observations and notes for one scenario */
class Runner {
  observations: StepObservation[] = [];
  notes: string[] = [];
  constructor(readonly ctx: GuideCheckContext) {}

  get client(): RemoteClient {
    return this.ctx.client;
  }

  /** A new GP test employee in the flow country (setup: failures abort the scenario) */
  async employee(code = FLOW_COUNTRY): Promise<{ id: string; email: string; legalEntityId: string }> {
    const e = await createGPTestEmployee(this.client, this.ctx.companySlug, code);
    if (e.changes.length) this.notes.push(`Setup: ${e.changes.join("; ")}`);
    return { id: e.employmentId, email: e.email, legalEntityId: e.legalEntityId };
  }

  /**
   * Save an employer form with test values (fields the form hides are left out, as a client
   * following the form would). `mutate` changes the payload for a negative test and returns
   * the field it changed.
   */
  async save(
    key: string,
    label: string,
    form: GPFormKey,
    employmentId: string,
    mutate?: (values: Json, schema: Json) => string | undefined
  ): Promise<StepObservation> {
    const def = GP_FORMS.find((f) => f.key === form)!;
    const target = CHECKABLE_FORMS[form]!;
    const schemaRes = await this.client.get(`/v1/countries/${FLOW_COUNTRY}/${def.form}?employment_id=${encodeURIComponent(employmentId)}`);
    const schema = schemaRes.status === 200 ? unwrapSchema(schemaRes.data) : null;
    if (!schema) throw new Error(`Reading ${def.label.toLowerCase()} failed (${schemaRes.status})${schemaRes.requestId ? ` [request ID ${schemaRes.requestId}]` : ""}`);
    const { values } = buildFormPayload(schema, analyzeSchema(schema).inertRequired, FLOW_COUNTRY);
    const changed = mutate?.(values, schema);
    const res = await this.client.put(target.path(employmentId), { [target.envelope]: values });
    return this.record(observation(key, label, res, target.envelope, changed));
  }

  /** POST /v1/employments/{id}/invite, as the SDK's invite step does */
  async invite(key: string, label: string, employmentId: string): Promise<StepObservation> {
    const res = await this.client.post(`/v1/employments/${encodeURIComponent(employmentId)}/invite`);
    return this.record(observation(key, label, res));
  }

  /** Create a GP employment directly (for scenarios createGPTestEmployee would refuse to set up) */
  async createEmployment(key: string, label: string, code: string, legalEntityId: string, email: string): Promise<StepObservation> {
    const schemaRes = await this.client.get(`/v1/countries/${code}/global_payroll_basic_information`);
    const schema = schemaRes.status === 200 ? unwrapSchema(schemaRes.data) : null;
    const res = await this.client.post("/v1/employments", {
      type: "global_payroll_employee",
      country_code: code,
      engaged_by_legal_entity_id: legalEntityId,
      basic_information: buildBasicInformation(schema, `GP Test ${code}`, email),
    });
    return this.record(observation(key, label, res));
  }

  /** What onboarding-steps says after a scenario (context only, never judged) */
  async steps(employmentId: string, when: string): Promise<void> {
    const res = await this.client.get(`/v1/employments/${encodeURIComponent(employmentId)}/onboarding-steps`);
    if (res.status !== 200) {
      this.notes.push(`Onboarding steps ${when}: ${res.status}`);
      return;
    }
    const data = isObj(res.data) ? res.data.data : undefined;
    const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.onboarding_steps) ? data.onboarding_steps : [];
    const text = list
      .map((s) => {
        if (!isObj(s)) return String(s);
        const name = s.name ?? s.step ?? s.type ?? s.key ?? "step";
        const state = s.status ?? s.state ?? (s.completed === true ? "completed" : s.completed === false ? "pending" : undefined);
        return state ? `${name} (${state})` : String(name);
      })
      .join(", ");
    this.notes.push(`Onboarding steps ${when}: ${text || "none listed"}`);
  }

  private record(obs: StepObservation): StepObservation {
    this.observations.push(obs);
    return obs;
  }
}

/** Turn a scenario's observations into a guide check result */
export function summarizeScenario(caseId: string, main: string, run: { observations: StepObservation[]; notes: string[] }): Omit<GuideCheckResult, "caseId" | "checkedAt"> {
  const judged = run.observations.map((o) => ({ o, exp: expectationFor(caseId, o.key), v: judge(o, expectationFor(caseId, o.key)) }));
  const setupFailed = judged.find((j) => j.o.key in (FUNCTIONAL_EXPECTATIONS._setup ?? {}) && j.v === "mismatch");
  const outcome: GuideCheckOutcome = setupFailed
    ? "error"
    : judged.some((j) => j.v === "mismatch") ? "differs"
    : judged.some((j) => j.v === "server_error") ? "error"
    : judged.some((j) => j.v === "new") ? "observed"
    : judged.length ? "as_recorded" : "error";

  const key = judged.find((j) => j.o.key === main) ?? judged[judged.length - 1];
  const summary = setupFailed
    ? `Setup failed before the scenario: ${describe(setupFailed.o, setupFailed.v, setupFailed.exp)}`
    : key ? describe(key.o, key.v, key.exp) : "No step ran";
  return {
    outcome,
    summary,
    details: [...judged.map((j) => describe(j.o, j.v, j.exp)), ...run.notes],
    requestIds: judged.flatMap((j) => (j.o.requestId ? [j.o.requestId] : [])),
  };
}

type Scenario = (r: Runner) => Promise<void>;

async function runScenario(ctx: GuideCheckContext, caseId: string, main: string, scenario: Scenario) {
  const r = new Runner(ctx);
  try {
    await scenario(r);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { outcome: "error" as const, summary: `Setup failed: ${msg}`, details: [...r.observations.map((o) => describe(o, judge(o, expectationFor(caseId, o.key)), expectationFor(caseId, o.key))), ...r.notes], requestIds: r.observations.flatMap((o) => (o.requestId ? [o.requestId] : [])) };
  }
  return summarizeScenario(caseId, main, r);
}

/** First required top-level field the payload filled with a plain value (not an object) */
function plainRequired(values: Json, schema: Json, pred: (prop: Json) => boolean = () => true): string | undefined {
  const req = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const props = isObj(schema.properties) ? schema.properties : {};
  return req.find((f) => f in values && !isObj(values[f]) && isObj(props[f]) && pred(props[f] as Json));
}

const hasChoices = (p: Json) => ["oneOf", "anyOf"].some((k) => Array.isArray(p[k])) || Array.isArray(p.enum);

/** A legal entity in the company with GP switched off, creating one if there is none */
async function nonGPEntity(r: Runner): Promise<{ id: string; country: string }> {
  const entities = summarizeEntities(await getCompanyEntities(r.client, r.ctx.companySlug));
  const off = entities.find((e) => !e.gpEnabled && e.countryCode);
  if (off) return { id: off.id, country: off.countryCode };
  const res = await r.client.post<{ data?: Json }>(`/v1/sandbox/companies/${r.ctx.companySlug}/legal-entities`, { country_code: NON_GP_COUNTRY });
  const created = isObj(res.data) && isObj(res.data.data) ? res.data.data : undefined;
  const id = created ? String(created.id ?? created.slug ?? created.legal_entity_id ?? "") : "";
  if (res.status >= 300 || !id) throw new Error(`Creating a ${NON_GP_COUNTRY} legal entity without GP failed (${res.status})`);
  r.notes.push(`Setup: added a ${NON_GP_COUNTRY} legal entity with GP switched off`);
  return { id, country: NON_GP_COUNTRY };
}

const CONTRACT = "contract_details" as const;
const ADMIN = "administrative_details" as const;

export const FUNCTIONAL_CHECKS: Record<string, { label: string; run: (ctx: GuideCheckContext) => Promise<Omit<GuideCheckResult, "caseId" | "checkedAt">> }> = {
  A9: {
    label: `Creates a ${FLOW_COUNTRY} test employee and invites them before any form is saved`,
    run: (ctx) => runScenario(ctx, "A9", "invite_without_forms", async (r) => {
      const e = await r.employee();
      await r.invite("invite_without_forms", "Invite with no forms saved", e.id);
      await r.steps(e.id, "after the invite");
    }),
  },
  A10: {
    label: `Creates a ${FLOW_COUNTRY} test employee, saves contract details only, then invites`,
    run: (ctx) => runScenario(ctx, "A10", "invite_after_contract", async (r) => {
      const e = await r.employee();
      await r.save("contract_details", "Contract details", CONTRACT, e.id);
      await r.invite("invite_after_contract", "Invite after contract details only", e.id);
      await r.steps(e.id, "after the invite");
    }),
  },
  A11: {
    label: `Creates a ${FLOW_COUNTRY} test employee, saves contract and administrative details, then invites`,
    run: (ctx) => runScenario(ctx, "A11", "invite_after_contract_and_admin", async (r) => {
      const e = await r.employee();
      await r.save("contract_details", "Contract details", CONTRACT, e.id);
      await r.save("administrative_details", "Administrative details", ADMIN, e.id);
      await r.steps(e.id, "before the invite");
      await r.invite("invite_after_contract_and_admin", "Invite after contract and administrative details", e.id);
      await r.steps(e.id, "after the invite");
    }),
  },
  A12: {
    label: `Completes the employer steps for a ${FLOW_COUNTRY} test employee, invites, then invites again`,
    run: (ctx) => runScenario(ctx, "A12", "invite_again", async (r) => {
      const e = await r.employee();
      await r.save("contract_details", "Contract details", CONTRACT, e.id);
      await r.save("administrative_details", "Administrative details", ADMIN, e.id);
      const first = await r.invite("invite_first", "First invite", e.id);
      if (first.blocked) {
        r.notes.push("The first invite was refused, so a second invite couldn't be tested");
        return;
      }
      await r.invite("invite_again", "Second invite", e.id);
    }),
  },
  A13: {
    label: `Creates a ${FLOW_COUNTRY} test employee and saves administrative details before contract details`,
    run: (ctx) => runScenario(ctx, "A13", "admin_before_contract", async (r) => {
      const e = await r.employee();
      await r.save("admin_before_contract", "Administrative details before contract details", ADMIN, e.id);
      await r.steps(e.id, "afterwards");
    }),
  },
  A14: {
    label: `Saves ${FLOW_COUNTRY} contract details with one required field left out`,
    run: (ctx) => runScenario(ctx, "A14", "contract_missing_field", async (r) => {
      const e = await r.employee();
      await r.save("contract_missing_field", "Contract details missing a required field", CONTRACT, e.id, (values, schema) => {
        const field = plainRequired(values, schema);
        if (field) delete values[field];
        return field;
      });
      const obs = r.observations[r.observations.length - 1];
      if (obs?.target) r.notes.push(`Left out: ${obs.target}`);
    }),
  },
  A15: {
    label: `Saves ${FLOW_COUNTRY} contract details with a value that isn't one of a field's options`,
    run: (ctx) => runScenario(ctx, "A15", "contract_invalid_option", async (r) => {
      const e = await r.employee();
      await r.save("contract_invalid_option", "Contract details with an invalid option", CONTRACT, e.id, (values, schema) => {
        const field = plainRequired(values, schema, hasChoices);
        if (field) values[field] = "not_a_valid_option";
        return field;
      });
      const obs = r.observations[r.observations.length - 1];
      if (obs?.target) r.notes.push(`Changed: ${obs.target} = "not_a_valid_option"`);
    }),
  },
  A16: {
    label: "Creates a GP employee on a legal entity that doesn't have GP switched on",
    run: (ctx) => runScenario(ctx, "A16", "create_on_non_gp_entity", async (r) => {
      const entity = await nonGPEntity(r);
      const email = `gp-test+non-gp-${Date.now()}@example.com`;
      const obs = await r.createEmployment("create_on_non_gp_entity", `GP employee on a ${entity.country} entity without GP`, entity.country, entity.id, email);
      if (!obs.blocked && obs.status < 300) r.notes.push("The employee was created; it stays in the test company");
    }),
  },
  A17: {
    label: `Creates a ${FLOW_COUNTRY} test employee, then another with the same email address`,
    run: (ctx) => runScenario(ctx, "A17", "create_with_used_email", async (r) => {
      const e = await r.employee();
      await r.createEmployment("create_with_used_email", "Second GP employee with the same email", FLOW_COUNTRY, e.legalEntityId, e.email);
    }),
  },
};
