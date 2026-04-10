/**
 * Lifecycle test matrix — employment status transitions beyond onboarding.
 *
 * Each test case defines a chain of transitions that walk an employment
 * through its full lifecycle (CM, CM+, or COR). The runner executes
 * each transition, verifies the resulting employment status, and
 * optionally asserts webhook events fired.
 */

export type LifecycleAction =
  | "submit_contract"
  | "select_subscription"
  | "invite"
  | "create_reserve"
  | "pay_reserve"
  | "sandbox_set"
  | "terminate_cor"
  | "upgrade_plan"
  | "cancel_onboarding";

export interface LifecycleTransition {
  state: string;
  action: LifecycleAction | null;
  actionParams?: Record<string, unknown>;
  expectedStatus: string;
  expectedWebhooks?: string[];
  pollTimeoutSec?: number;
}

export interface LifecycleExpected {
  finalStatus: string;
  finalBHRStatus?: string;
  note?: string;
}

export interface LifecycleTestCase {
  section?: string;
  id?: string;
  desc?: string;
  lifecycle?: "CM" | "CM+" | "COR";
  entity?: string;
  hire?: string;
  ir35?: string;
  nationality?: string;
  transitions?: LifecycleTransition[];
  expected?: LifecycleExpected;
}

export const LIFECYCLE_MATRIX: LifecycleTestCase[] = [
  // ── CM Lifecycle ──────────────────────────────────────────────
  { section: "CM Lifecycle" },
  {
    id: "L1(CM)",
    desc: "CM happy path — created to active",
    lifecycle: "CM",
    entity: "GBR",
    hire: "PRT",
    transitions: [
      { state: "created", action: null, expectedStatus: "created" },
      { state: "contract submitted", action: "submit_contract", expectedStatus: "created" },
      {
        state: "invited",
        action: "invite",
        expectedStatus: "invited",
        expectedWebhooks: ["employment.status.updated"],
      },
      {
        state: "active",
        action: "sandbox_set",
        actionParams: { status: "active" },
        expectedStatus: "active",
        expectedWebhooks: ["employment.onboarding.completed"],
      },
    ],
    expected: { finalStatus: "active" },
  },
  {
    id: "L5(CM)",
    desc: "CM + nationality (BHR) — created to active",
    lifecycle: "CM",
    entity: "GBR",
    hire: "BHR",
    nationality: "national",
    transitions: [
      { state: "created", action: null, expectedStatus: "created" },
      { state: "contract submitted", action: "submit_contract", expectedStatus: "created" },
      {
        state: "invited",
        action: "invite",
        expectedStatus: "invited",
        expectedWebhooks: ["employment.status.updated"],
      },
      {
        state: "active",
        action: "sandbox_set",
        actionParams: { status: "active" },
        expectedStatus: "active",
        expectedWebhooks: ["employment.onboarding.completed"],
      },
    ],
    expected: { finalStatus: "active" },
  },
  {
    id: "L9(CANCEL)",
    desc: "CM cancellation during onboarding",
    lifecycle: "CM",
    entity: "GBR",
    hire: "PRT",
    transitions: [
      { state: "created", action: null, expectedStatus: "created" },
      { state: "cancelled", action: "cancel_onboarding", expectedStatus: "404", pollTimeoutSec: 15 },
    ],
    expected: { finalStatus: "404", note: "Employment deleted after cancel" },
  },
  {
    id: "L10(ARCHIVE)",
    desc: "CM archival after active",
    lifecycle: "CM",
    entity: "GBR",
    hire: "PRT",
    transitions: [
      { state: "created", action: null, expectedStatus: "created" },
      { state: "contract submitted", action: "submit_contract", expectedStatus: "created" },
      { state: "invited", action: "invite", expectedStatus: "invited" },
      {
        state: "active",
        action: "sandbox_set",
        actionParams: { status: "active" },
        expectedStatus: "active",
      },
      {
        state: "archived",
        action: "sandbox_set",
        actionParams: { status: "archived" },
        expectedStatus: "archived",
        expectedWebhooks: [
          "employment.status.updated",
          "employment.user_status.deactivated",
        ],
      },
    ],
    expected: { finalStatus: "archived" },
  },

  // ── CM+ Lifecycle ─────────────────────────────────────────────
  { section: "CM+ Lifecycle" },
  {
    id: "L2(CM+)",
    desc: "CM+ happy path — created to active",
    lifecycle: "CM+",
    entity: "GBR",
    hire: "PRT",
    transitions: [
      { state: "created", action: null, expectedStatus: "created" },
      { state: "subscription selected", action: "select_subscription", actionParams: { product: "CM+" }, expectedStatus: "created" },
      { state: "contract submitted", action: "submit_contract", expectedStatus: "created" },
      {
        state: "invited",
        action: "invite",
        expectedStatus: "invited",
        expectedWebhooks: ["employment.status.updated"],
      },
      {
        state: "active",
        action: "sandbox_set",
        actionParams: { status: "active" },
        expectedStatus: "active",
        expectedWebhooks: ["employment.onboarding.completed"],
      },
    ],
    expected: { finalStatus: "active" },
  },

  // ── Plan Changes ──────────────────────────────────────────────
  { section: "Plan Changes" },
  {
    id: "L6(CM→CM+)",
    desc: "CM upgrade to CM+ after active",
    lifecycle: "CM",
    entity: "GBR",
    hire: "PRT",
    transitions: [
      { state: "created", action: null, expectedStatus: "created" },
      { state: "contract submitted", action: "submit_contract", expectedStatus: "created" },
      { state: "invited", action: "invite", expectedStatus: "invited" },
      {
        state: "active",
        action: "sandbox_set",
        actionParams: { status: "active" },
        expectedStatus: "active",
      },
      {
        state: "upgraded to CM+",
        action: "upgrade_plan",
        actionParams: { operation: "upgrade" },
        expectedStatus: "active",
        expectedWebhooks: ["employment.contractor_management_plan.updated"],
      },
    ],
    expected: { finalStatus: "active", note: "Plan upgraded CM→CM+" },
  },
  {
    id: "L7(CM+→CM)",
    desc: "CM+ downgrade to CM after active",
    lifecycle: "CM+",
    entity: "GBR",
    hire: "PRT",
    transitions: [
      { state: "created", action: null, expectedStatus: "created" },
      { state: "subscription selected", action: "select_subscription", actionParams: { product: "CM+" }, expectedStatus: "created" },
      { state: "contract submitted", action: "submit_contract", expectedStatus: "created" },
      { state: "invited", action: "invite", expectedStatus: "invited" },
      {
        state: "active",
        action: "sandbox_set",
        actionParams: { status: "active" },
        expectedStatus: "active",
      },
      {
        state: "downgraded to CM",
        action: "upgrade_plan",
        actionParams: { operation: "downgrade" },
        expectedStatus: "active",
        expectedWebhooks: ["employment.contractor_management_plan.updated"],
      },
    ],
    expected: { finalStatus: "active", note: "Plan downgraded CM+→CM" },
  },

  // ── COR Lifecycle ─────────────────────────────────────────────
  { section: "COR Lifecycle" },
  {
    id: "L3(COR)",
    desc: "COR full lifecycle — reserve payment to active",
    lifecycle: "COR",
    entity: "GBR",
    hire: "PRT",
    transitions: [
      { state: "created", action: null, expectedStatus: "created" },
      { state: "subscription selected", action: "select_subscription", actionParams: { product: "COR" }, expectedStatus: "created" },
      { state: "contract submitted", action: "submit_contract", expectedStatus: "created" },
      {
        state: "awaiting reserve",
        action: "create_reserve",
        expectedStatus: "created_awaiting_reserve",
        expectedWebhooks: ["employment.status.updated"],
      },
      {
        state: "reserve paid",
        action: "pay_reserve",
        expectedStatus: "created_reserve_paid",
        expectedWebhooks: ["employment.status.updated"],
        pollTimeoutSec: 30,
      },
      {
        state: "invited",
        action: "invite",
        expectedStatus: "invited",
        expectedWebhooks: ["employment.status.updated"],
      },
      {
        state: "active",
        action: "sandbox_set",
        actionParams: { status: "active" },
        expectedStatus: "active",
        expectedWebhooks: ["employment.onboarding.completed"],
      },
    ],
    expected: { finalStatus: "active" },
  },
  {
    id: "L4(COR)",
    desc: "COR + IR35 (USA→GBR) — reserve to active",
    lifecycle: "COR",
    entity: "USA",
    hire: "GBR",
    ir35: "outside",
    transitions: [
      { state: "created", action: null, expectedStatus: "created" },
      { state: "subscription selected", action: "select_subscription", actionParams: { product: "COR" }, expectedStatus: "created" },
      { state: "contract submitted", action: "submit_contract", expectedStatus: "created" },
      {
        state: "awaiting reserve",
        action: "create_reserve",
        expectedStatus: "created_awaiting_reserve",
        expectedWebhooks: ["employment.status.updated"],
      },
      {
        state: "reserve paid",
        action: "pay_reserve",
        expectedStatus: "created_reserve_paid",
        expectedWebhooks: ["employment.status.updated"],
        pollTimeoutSec: 30,
      },
      {
        state: "invited",
        action: "invite",
        expectedStatus: "invited",
      },
      {
        state: "active",
        action: "sandbox_set",
        actionParams: { status: "active" },
        expectedStatus: "active",
        expectedWebhooks: ["employment.onboarding.completed"],
      },
    ],
    expected: { finalStatus: "active" },
  },

  // ── COR Termination ───────────────────────────────────────────
  { section: "COR Termination" },
  {
    id: "L8(COR-TERM)",
    desc: "COR termination — initiation + execution to archived",
    lifecycle: "COR",
    entity: "GBR",
    hire: "PRT",
    transitions: [
      { state: "created", action: null, expectedStatus: "created" },
      { state: "subscription selected", action: "select_subscription", actionParams: { product: "COR" }, expectedStatus: "created" },
      { state: "contract submitted", action: "submit_contract", expectedStatus: "created" },
      {
        state: "awaiting reserve",
        action: "create_reserve",
        expectedStatus: "created_awaiting_reserve",
      },
      {
        state: "reserve paid",
        action: "pay_reserve",
        expectedStatus: "created_reserve_paid",
        pollTimeoutSec: 30,
      },
      { state: "invited", action: "invite", expectedStatus: "invited" },
      {
        state: "active",
        action: "sandbox_set",
        actionParams: { status: "active" },
        expectedStatus: "active",
      },
      {
        state: "termination initiated",
        action: "terminate_cor",
        expectedStatus: "active",
        expectedWebhooks: ["employment.contractor_of_record_termination.initiated"],
      },
      {
        state: "termination executed",
        action: "sandbox_set",
        actionParams: { status: "archived" },
        expectedStatus: "archived",
        expectedWebhooks: ["employment.contractor_of_record_termination.executed"],
        pollTimeoutSec: 10,
      },
    ],
    expected: { finalStatus: "archived" },
  },
];
