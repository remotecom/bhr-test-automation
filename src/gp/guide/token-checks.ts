/**
 * Token checks for the testing guide's Tokens tab: what the jwt-bearer grant returns when an
 * assertion is wrong. Read-only: no token is kept and nothing in the company changes, so these run
 * with the quick checks.
 *
 * T6 (an employment in a company this client doesn't manage) and T7/T9 (integration settings
 * switched off) need a second client or a changed setting, so they stay manual.
 */

import { randomUUID } from "node:crypto";
import type { ApiResponse } from "../../client";
import type { GuideCheckContext, GuideCheckOutcome, GuideCheckResult } from "./checks";

type Grant = ApiResponse<{ error?: string; error_description?: string; scope?: string }>;
type CheckFn = (ctx: GuideCheckContext) => Promise<Omit<GuideCheckResult, "caseId" | "checkedAt">>;

/** The scope the partner's server asks for in the GP SDK flows */
const SCOPE = "all:write";

/** Same length as a real secret, so only its value is wrong */
const WRONG_SECRET = "x".repeat(43);

export const employeeSub = (employmentId: string) => `urn:remote-api:employee:employment:${employmentId}`;
export const managerSub = (userId: string) => `urn:remote-api:company-manager:user:${userId}`;

/** One line for a grant response: status, error and description (never a token) */
export function describeGrant(label: string, res: Grant): string {
  if (res.status < 300) return `${label}: token issued (${res.status})`;
  const { error, error_description } = res.data;
  const parts = [error, error_description ? `"${error_description}"` : "no error_description"].filter(Boolean).join(", ");
  return `${label}: ${res.status} ${parts || res.rawText || ""}`.trim();
}

/** Refused with this status, and an error_description containing `description` */
function refusedWith(res: Grant, status: number, description: string): boolean {
  return res.status === status && (res.data.error_description ?? "").toLowerCase().includes(description.toLowerCase());
}

const ids = (...r: Grant[]) => r.flatMap((g) => (g.requestId ? [g.requestId] : []));

export const TOKEN_CHECKS: Record<string, { label: string; run: CheckFn }> = {
  T5: {
    label: "Requests an employee assertion token for an employment ID that doesn't exist",
    async run(ctx) {
      const res = await ctx.client.assertionGrant(employeeSub(randomUUID()), SCOPE);
      const line = describeGrant("Employee assertion for a random employment ID", res);
      const outcome: GuideCheckOutcome = refusedWith(res, 400, "Subject not found or not managed by this client") ? "as_recorded" : "differs";
      return { outcome, summary: line, details: [], requestIds: ids(res) };
    },
  },
  T8: {
    label: "Requests a company-manager assertion token for the company owner with the right secret, then with a wrong one",
    async run(ctx) {
      const company = await ctx.client.get<{ data?: { company?: { company_owner_user_id?: string } } }>(`/v1/companies/${ctx.companySlug}`);
      const owner = company.data?.data?.company?.company_owner_user_id;
      if (!owner) return { outcome: "error", summary: `Couldn't read the company owner's user ID (${company.status})`, details: [] };
      const sub = managerSub(owner);

      // Control: the same subject with the right secret must work, or the negatives prove nothing
      const control = await ctx.client.assertionGrant(sub, SCOPE);
      const controlLine = describeGrant("Right secret (control)", control);
      if (control.status >= 300) {
        return { outcome: "inconclusive", summary: `The control request was refused, so a wrong secret can't be told apart: ${controlLine}`, details: [], requestIds: ids(control) };
      }

      const rotated = await ctx.client.assertionGrant(sub, SCOPE, { signWith: WRONG_SECRET, sendWith: WRONG_SECRET });
      const signedOnly = await ctx.client.assertionGrant(sub, SCOPE, { signWith: WRONG_SECRET });
      const lines = [
        controlLine,
        describeGrant("Wrong secret, signing and sending (a rotated secret)", rotated),
        describeGrant("Right secret sent, JWT signed with a wrong one", signedOnly),
      ];
      // Recorded 21 Oct: a wrong secret in Basic auth is reported as bad credentials; a JWT signed
      // with a wrong secret (the right one sent) as a bad assertion
      const matches = [refusedWith(rotated, 400, "Invalid client credentials"), refusedWith(signedOnly, 400, "Invalid JWT assertion")];
      return {
        outcome: matches.every(Boolean) ? "as_recorded" : "differs",
        summary: matches.every(Boolean) ? 'Both refused with 400: "Invalid client credentials" (rotated secret), "Invalid JWT assertion" (wrongly signed JWT)' : lines[matches[0] ? 2 : 1],
        details: lines,
        requestIds: ids(rotated, signedOnly),
      };
    },
  },
};
