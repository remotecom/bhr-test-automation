/**
 * Employee self-onboarding checks for the testing guide (E rows): what the /v1/employee/* endpoints
 * return to an invited employee, called the way the SDK's PayrollEmployeeOnboardingFlow does, with
 * an employee assertion token (jwt-bearer grant) and the SDK's envelopes.
 *
 * They act as an invited GBR GP employee already in the company (the flow checks leave several), so
 * they create no employees. They save personal and bank details to that employee, so they count as
 * quick checks that write, like A3/A4.
 *
 * E2 (a country that doesn't require name) would need an employee in such a country; E5 and E6 are
 * about what the SDK shows, not what the API returns. Those stay manual.
 */

import type { ApiResponse, RemoteClient } from "../../client";
import { buildFormPayload, rejectedFields } from "../field-check";
import { analyzeSchema, unwrapSchema } from "../schema-analysis";
import type { GuideCheckContext, GuideCheckOutcome, GuideCheckResult } from "./checks";
import { employeeSub } from "./token-checks";

type Json = Record<string, unknown>;
type CheckFn = (ctx: GuideCheckContext) => Promise<Omit<GuideCheckResult, "caseId" | "checkedAt">>;

/** Country of the employee the checks act as */
export const EMPLOYEE_COUNTRY = "GBR";
const SCOPE = "all:write";
export const NEEDS_INVITED = `Needs an invited ${EMPLOYEE_COUNTRY} GP employee in the company: Run flow checks once (A10 and A11 leave invited employees)`;

interface EmployeeSession {
  id: string;
  /** Acts as the employee */
  client: RemoteClient;
}

/** One employee per run: every E check in a runGuideChecks call shares it */
const sessions = new WeakMap<GuideCheckContext, Promise<EmployeeSession | undefined>>();

function session(ctx: GuideCheckContext): Promise<EmployeeSession | undefined> {
  let s = sessions.get(ctx);
  if (!s) {
    s = findInvitedEmployee(ctx).then((id) => (id ? { id, client: ctx.client.asAssertion(employeeSub(id), SCOPE) } : undefined));
    sessions.set(ctx, s);
  }
  return s;
}

/** An invited GP employee in EMPLOYEE_COUNTRY, from GET /v1/employments (paged) */
export async function findInvitedEmployee(ctx: GuideCheckContext): Promise<string | undefined> {
  for (let page = 1; page <= 10; page++) {
    const res = await ctx.client.get<{ data?: { employments?: Json[]; total_pages?: number } }>(`/v1/employments?page=${page}`);
    if (res.status !== 200) return undefined;
    const list = res.data?.data?.employments ?? [];
    const hit = list.find(
      (e) =>
        e.type === "global_payroll_employee" &&
        e.status === "invited" &&
        String((e.country as Json | undefined)?.code ?? "").toUpperCase() === EMPLOYEE_COUNTRY
    );
    if (typeof hit?.id === "string") return hit.id;
    if (!res.data?.data?.total_pages || page >= res.data.data.total_pages) return undefined;
  }
  return undefined;
}

/** A form filled with test values the way the SDK would (read with the company token, as the SDK's server does) */
async function filledForm(ctx: GuideCheckContext, form: string, employmentId: string): Promise<Json | undefined> {
  const res = await ctx.client.get(`/v1/countries/${EMPLOYEE_COUNTRY}/${form}?employment_id=${encodeURIComponent(employmentId)}`);
  const schema = res.status === 200 ? unwrapSchema(res.data) : null;
  return schema ? buildFormPayload(schema, analyzeSchema(schema).inertRequired, EMPLOYEE_COUNTRY).values : undefined;
}

function message(res: ApiResponse<unknown>): string {
  const d = res.data as Json | null;
  if (d && typeof d === "object") {
    const parts = [typeof d.message === "string" ? d.message : "", d.errors ? JSON.stringify(d.errors) : ""].filter(Boolean);
    if (parts.length) return parts.join(" ").slice(0, 300);
  }
  return (res.rawText || "").slice(0, 300);
}

/** One line for a response: status, and Remote's message when refused */
function line(label: string, res: ApiResponse<unknown>): string {
  return res.status < 300 ? `${label}: accepted (${res.status})` : `${label}: ${res.status} ${message(res)}`.trim();
}

const ids = (...r: ApiResponse<unknown>[]) => r.flatMap((x) => (x.requestId ? [x.requestId] : []));
const savePersonal = (s: EmployeeSession, values: Json) => s.client.put("/v1/employee/personal-details", { personal_details: values });

/** Personal details, filled; the check changes one field in a copy */
async function personalCheck(
  ctx: GuideCheckContext,
  run: (s: EmployeeSession, values: Json) => Promise<Omit<GuideCheckResult, "caseId" | "checkedAt">>
) {
  const s = await session(ctx);
  if (!s) return { outcome: "skipped" as const, summary: NEEDS_INVITED, details: [] };
  const values = await filledForm(ctx, "global_payroll_personal_details", s.id);
  if (!values) return { outcome: "error" as const, summary: `Couldn't read ${EMPLOYEE_COUNTRY}'s personal-details form for the employee`, details: [] };
  return run(s, values);
}

export const EMPLOYEE_CHECKS: Record<string, { label: string; run: CheckFn }> = {
  E1: {
    label: `As an invited ${EMPLOYEE_COUNTRY} employee, saves personal details without name, then with it (the endpoint the SDK step calls)`,
    run: (ctx) =>
      personalCheck(ctx, async (s, values) => {
        const { name: _name, ...withoutName } = values;
        const without = await savePersonal(s, withoutName);
        const full = await savePersonal(s, values);
        const details = [line("Without name", without), line("With name", full)];
        const refusedWithout = without.status === 422 && rejectedFields(without.data).includes("name");
        const asRecorded = refusedWithout && full.status < 300;
        return {
          outcome: asRecorded ? "as_recorded" : "differs",
          summary: asRecorded ? "422 without name, naming it; 200 with it" : refusedWithout ? details[1] : details[0],
          details,
          requestIds: ids(without, full),
        };
      }),
  },
  E3: {
    label: `As an invited ${EMPLOYEE_COUNTRY} employee, saves personal details with nationality "GBR" (an ISO code, not a display name)`,
    run: (ctx) =>
      personalCheck(ctx, async (s, values) => {
        const res = await savePersonal(s, { ...values, nationality: "GBR" });
        const ok = res.status === 422 && /type mismatch/i.test(message(res));
        return { outcome: ok ? "as_recorded" : "differs", summary: line('nationality: "GBR"', res), details: [], requestIds: ids(res) };
      }),
  },
  E4: {
    label: `As an invited ${EMPLOYEE_COUNTRY} employee, saves personal details with title "Mr" (as displayed, not the lowercase value)`,
    run: (ctx) =>
      personalCheck(ctx, async (s, values) => {
        const res = await savePersonal(s, { ...values, title: "Mr" });
        const ok = res.status === 422 && rejectedFields(res.data).includes("title") && /invalid/i.test(message(res));
        return { outcome: ok ? "as_recorded" : "differs", summary: line('title: "Mr"', res), details: [], requestIds: ids(res) };
      }),
  },
  E7: {
    label: `As an invited ${EMPLOYEE_COUNTRY} employee (not yet active), calls GET /v1/employee/current`,
    async run(ctx) {
      const s = await session(ctx);
      if (!s) return { outcome: "skipped", summary: NEEDS_INVITED, details: [] };
      const res = await s.client.get("/v1/employee/current");
      // A known issue: recorded as still reproducing while Remote refuses it before activation
      const outcome: GuideCheckOutcome = res.status >= 400 && /expected to be active/i.test(message(res)) ? "as_recorded" : "differs";
      return { outcome, summary: line("GET /v1/employee/current", res), details: [], requestIds: ids(res) };
    },
  },
  E8: {
    label: `As an invited ${EMPLOYEE_COUNTRY} employee, saves bank details with PUT /v1/employee/bank-account`,
    async run(ctx) {
      const s = await session(ctx);
      if (!s) return { outcome: "skipped", summary: NEEDS_INVITED, details: [] };
      const values = await filledForm(ctx, "global_payroll_bank_account_details", s.id);
      if (!values) return { outcome: "error", summary: `Couldn't read ${EMPLOYEE_COUNTRY}'s bank-details form for the employee`, details: [] };
      const res = await s.client.put("/v1/employee/bank-account", { bank_account_details: values });
      const fields = rejectedFields(res.data);
      const outcome: GuideCheckOutcome = res.status < 300 ? "as_recorded" : res.status === 422 && fields.length ? "inconclusive" : "differs";
      const details = outcome === "inconclusive" ? [`A test value was rejected (${fields.join(", ")}), so this doesn't show whether the save works`] : [];
      return { outcome, summary: line("PUT /v1/employee/bank-account", res), details, requestIds: ids(res) };
    },
  },
};
