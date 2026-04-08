/**
 * COR eligibility questionnaire (COR-only flow).
 *
 * Schema:  GET  /v1/contractors/schemas/eligibility-questionnaire?type=contractor_of_record&json_schema_version=1
 * Submit:  POST /v1/contractors/eligibility-questionnaire
 *          Body: { employment_slug, responses, type: "contractor_of_record" }
 *
 * The schema is global (not per-employment). Questions are JSON Schema properties
 * with enum values. Non-blocking answers: "no" for risk questions, "yes" for acknowledgement.
 */

import type { RemoteClient } from "../client";
import { trace } from "../trace";

export interface QuestionnaireSchema {
  version: number;
  schema: {
    properties: Record<
      string,
      {
        title: string;
        description?: string;
        type?: string;
        enum?: string[];
        const?: string;
        "x-jsf-presentation"?: {
          inputType: string;
          options?: Array<{ label: string; value: string }>;
          checkboxValue?: string;
        };
      }
    >;
    required?: string[];
  };
}

export interface QuestionnaireResult {
  is_blocking: boolean;
  slug: string;
  type: string;
  responses: Record<string, string>;
  submitted_at: string;
  [key: string]: unknown;
}

/** Fetch the global COR eligibility questionnaire schema */
export async function getQuestionnaireSchema(
  client: RemoteClient,
  _employmentId?: string
): Promise<QuestionnaireSchema> {
  const { status, data } = await client.get<{ data: QuestionnaireSchema }>(
    `/v1/contractors/schemas/eligibility-questionnaire?type=contractor_of_record&json_schema_version=1`
  );

  if (status !== 200) {
    throw new Error(
      `GET eligibility-questionnaire schema failed (${status}): ${JSON.stringify(data)}`
    );
  }
  return data.data;
}

/** Submit questionnaire answers for an employment. */
export async function submitQuestionnaire(
  client: RemoteClient,
  employmentId: string,
  responses: Record<string, string>
): Promise<QuestionnaireResult> {
  const { status, data } = await client.post<{ data: QuestionnaireResult }>(
    `/v1/contractors/eligibility-questionnaire?json_schema_version=1`,
    {
      employment_slug: employmentId,
      responses,
      type: "contractor_of_record",
    }
  );

  if (status !== 200 && status !== 201) {
    throw new Error(
      `POST eligibility-questionnaire failed (${status}): ${JSON.stringify(data)}`
    );
  }
  trace.questionnaireResult(employmentId, data.data.is_blocking);
  return data.data;
}

/**
 * Build non-blocking answers from schema.
 * Risk questions → "no", acknowledgement checkbox → "yes".
 */
export function buildPassingAnswers(
  schema: QuestionnaireSchema
): Record<string, string> {
  const answers: Record<string, string> = {};
  const props = schema.schema.properties;

  for (const [key, field] of Object.entries(props)) {
    if (field.const) {
      // Checkbox with a fixed value (e.g. direct_engagement_acknowledgement = "yes")
      answers[key] = field.const;
    } else if (field.enum) {
      // Radio/select — pick "no" for risk questions (non-blocking)
      answers[key] = field.enum.includes("no") ? "no" : field.enum[0];
    }
  }
  return answers;
}

/**
 * Build blocking answers from schema.
 * Risk questions → "yes" (blocking), acknowledgement → "yes" (required).
 */
export function buildBlockingAnswers(
  schema: QuestionnaireSchema
): Record<string, string> {
  const answers: Record<string, string> = {};
  const props = schema.schema.properties;

  for (const [key, field] of Object.entries(props)) {
    if (field.const) {
      answers[key] = field.const;
    } else if (field.enum) {
      // Pick "yes" for risk questions (blocking)
      answers[key] = field.enum.includes("yes") ? "yes" : field.enum[0];
    }
  }
  return answers;
}
