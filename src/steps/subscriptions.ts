/**
 * Step 5: GET /v1/contractors/employments/:id/contractor-subscriptions — check available products
 * Step 6: POST /v1/contractors/employments/:id/contractor-plus-subscription — select CM+
 *         POST /v1/contractors/employments/:id/contractor-cor-subscription — select COR
 *
 * Product identifiers in the API: "standard" (CM), "plus" (CM+), "cor" (COR)
 */

import type { RemoteClient } from "../client";
import { trace } from "../trace";

export interface SubscriptionProduct {
  identifier: string;
  short_name: string;
  name: string;
  tier: string;
  frequency: string;
  employment_type: string;
  active: boolean;
  [key: string]: unknown;
}

export interface SubscriptionSummary {
  product: SubscriptionProduct;
  price: { amount: number; final_amount: number };
  currency: { code: string; [key: string]: unknown };
  eligibility_questionnaire: unknown;
  [key: string]: unknown;
}

interface SubscriptionsResponse {
  data: SubscriptionSummary[];
}

const SUBSCRIPTIONS_BASE = "/v1/contractors/employments";

/** Get available contractor subscriptions (products) for an employment */
export async function getSubscriptions(
  client: RemoteClient,
  employmentId: string
): Promise<SubscriptionSummary[]> {
  const { status, data } = await client.get<SubscriptionsResponse>(
    `${SUBSCRIPTIONS_BASE}/${employmentId}/contractor-subscriptions`
  );
  if (status !== 200) {
    throw new Error(
      `GET contractor-subscriptions failed (${status}): ${JSON.stringify(data)}`
    );
  }
  const subs = data.data;
  trace.subscriptions(employmentId, subs.map((s) => s.product.short_name));
  return subs;
}

/** Extract product short names from subscription summaries (e.g. "COR", "CM", "CM+") */
export function getAvailableProducts(subscriptions: SubscriptionSummary[]): string[] {
  return subscriptions.map((s) => s.product.short_name);
}

/** Select CM+ subscription */
export async function selectPlusSubscription(
  client: RemoteClient,
  employmentId: string
): Promise<unknown> {
  const { status, data } = await client.post(
    `${SUBSCRIPTIONS_BASE}/${employmentId}/contractor-plus-subscription`,
    { operation: "upgrade" }
  );
  if (status !== 200 && status !== 201) {
    throw new Error(
      `POST contractor-plus-subscription failed (${status}): ${JSON.stringify(data)}`
    );
  }
  return data;
}

/** Select COR subscription */
export async function selectCORSubscription(
  client: RemoteClient,
  employmentId: string
): Promise<unknown> {
  const { status, data } = await client.post(
    `${SUBSCRIPTIONS_BASE}/${employmentId}/contractor-cor-subscription`
  );
  if (status !== 200 && status !== 201) {
    throw new Error(
      `POST contractor-cor-subscription failed (${status}): ${JSON.stringify(data)}`
    );
  }
  return data;
}
