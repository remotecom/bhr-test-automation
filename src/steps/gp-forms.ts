/**
 * Global Payroll form schema probe (read-only).
 *
 * GET /v1/countries/{cc}/{form}
 *   200 means the form is published for the country.
 *   422 {"message":"Form not available for requested country"} (or a 404) means unsupported.
 *
 * Notes:
 *   - Use the global_payroll_ prefixed names. The unprefixed names return the EOR schema with a 200.
 *   - Without employment_id, contract details returns the generic version of the schema. That is fine
 *     for checking availability. Whether a field is hidden for a specific entity (for example
 *     overtime_eligible on entities that are not on TT2.0) can only be checked against a real employment.
 */

import type { RemoteClient } from "../client";
import type { FormProbe } from "../gp/types";
import { analyzeSchema, unwrapSchema } from "../gp/schema-analysis";

const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  if (typeof d.message === "string") return d.message;
  if (typeof d.error === "string") return d.error;
  if (d.errors) return JSON.stringify(d.errors).slice(0, 300);
  return JSON.stringify(d).slice(0, 300);
}

export async function probeGPForm(
  client: RemoteClient,
  countryCode: string,
  form: string,
  opts: { employmentId?: string } = {}
): Promise<FormProbe> {
  const qs = opts.employmentId ? `?employment_id=${encodeURIComponent(opts.employmentId)}` : "";
  const path = `/v1/countries/${encodeURIComponent(countryCode)}/${form}${qs}`;
  const started = Date.now();

  let lastErr: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { status, data } = await client.get(path);

      if (RETRYABLE.has(status) && attempt < MAX_ATTEMPTS) {
        await sleep(500 * attempt * attempt);
        continue;
      }

      if (status === 200) {
        const schema = unwrapSchema(data);
        if (!schema) {
          return {
            form, status: "error", httpStatus: status,
            message: "200 but no JSON schema in response",
            durationMs: Date.now() - started,
          };
        }
        return {
          form, status: "available", httpStatus: status,
          analysis: analyzeSchema(schema),
          durationMs: Date.now() - started,
        };
      }

      if (status === 422 || status === 404) {
        return {
          form, status: "unavailable", httpStatus: status,
          message: extractMessage(data),
          durationMs: Date.now() - started,
        };
      }

      const hint = status === 401 || status === 403 ? " (check the company token's scopes)" : "";
      return {
        form, status: "error", httpStatus: status,
        message: (extractMessage(data) || `HTTP ${status}`) + hint,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) await sleep(500 * attempt);
    }
  }

  return { form, status: "error", message: lastErr || "request failed", durationMs: Date.now() - started };
}
