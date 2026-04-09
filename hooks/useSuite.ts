"use client";

import { useState, useCallback, useRef } from "react";
import { TEST_MATRIX, type TestCase, type TestExpected } from "@/data/test-matrix";
import { getCompanyHeaders } from "@/components/CompanySelector";

export interface TestState {
  status?: string;
  duration?: number;
  eeId?: string;
  eeEmail?: string;
  entityId?: string;
  products?: string[];
  countryProducts?: string[];
  questionnaireResult?: boolean | null;
  ir35Status?: string;
  eligibility?: { standard: boolean; plus: boolean; cor: boolean };
  corCodes?: string[];
  error?: string | null;
}

export interface SuiteSummary {
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}

export interface SuiteState {
  running: boolean;
  status: string;
  testState: Map<string, TestState>;
  summary: SuiteSummary | null;
  lastEntityId: string | null;
}

function extractTestId(name: unknown): string {
  if (typeof name !== "string") return String(name ?? "").slice(0, 20);
  const m = name.match(/^([A-Z]\d+(?:\([^)]+\))?)/);
  return m ? m[1] : name.slice(0, 20);
}

export function useSuite() {
  const [state, setState] = useState<SuiteState>({
    running: false,
    status: "Ready",
    testState: new Map(),
    summary: null,
    lastEntityId: null,
  });
  const abortRef = useRef<AbortController | null>(null);
  const filteredRunRef = useRef(false);
  const filterIdRef = useRef<string | null>(null);

  // Event buffer — collects between test:result events
  const bufferRef = useRef({
    eeId: null as string | null,
    eeEmail: null as string | null,
    products: null as string[] | null,
    countryProducts: null as string[] | null,
    questionnaireResult: null as boolean | null,
    ir35Status: null as string | null,
    eligibility: null as { standard: boolean; plus: boolean; cor: boolean } | null,
    corCodes: null as string[] | null,
  });
  const lastEntityIdRef = useRef<string | null>(null);

  const handleEvent = useCallback((event: string, data: Record<string, unknown>) => {
    const buf = bufferRef.current;

    switch (event) {
      case "suite:start":
        setState((s) => ({
          ...s,
          status: "Running...",
          testState: filteredRunRef.current ? s.testState : new Map(),
          summary: null,
        }));
        bufferRef.current = {
          eeId: null, eeEmail: null, products: null,
          countryProducts: null, questionnaireResult: null,
          ir35Status: null, eligibility: null, corCodes: null,
        };
        lastEntityIdRef.current = null;
        break;

      case "suite:collected":
        setState((s) => {
          const newState = new Map(s.testState);
          const tests = data.tests as Array<string | { testId: string; name: string }> | undefined;
          if (tests) {
            for (const entry of tests) {
              const id = typeof entry === "string"
                ? extractTestId(entry)
                : entry.testId || extractTestId(entry.name);
              // For filtered runs, only mark the target test as running
              if (id && (!filteredRunRef.current || id === filterIdRef.current)) {
                newState.set(id, { ...newState.get(id), status: "run" });
              }
            }
          }
          const count = filteredRunRef.current ? 1 : (tests?.length || 0);
          return { ...s, testState: newState, status: `Running ${count} tests...` };
        });
        break;

      case "employment":
        buf.eeId = data.id as string;
        buf.eeEmail = data.email as string;
        break;

      case "entity:swap":
        lastEntityIdRef.current = data.entityId as string;
        setState((s) => ({ ...s, lastEntityId: data.entityId as string }));
        break;

      case "subscriptions":
        buf.products = data.products as string[];
        break;

      case "country:eligibility":
        buf.countryProducts = data.products as string[];
        break;

      case "questionnaire:result":
        buf.questionnaireResult = data.isBlocking as boolean;
        break;

      case "ir35:status":
        buf.ir35Status = data.status as string;
        break;

      case "eligibility:result":
        buf.eligibility = {
          standard: data.standard as boolean,
          plus: data.plus as boolean,
          cor: data.cor as boolean,
        };
        buf.corCodes = (data.cor_supported_country_codes as string[]) || [];
        break;

      case "test:result": {
        const id = (data.testId as string) || extractTestId(data.name as string);
        setState((s) => {
          const newState = new Map(s.testState);
          const existing = newState.get(id) || {};
          // For filtered runs, don't overwrite existing pass/fail with skip
          if (filteredRunRef.current && data.state === "skip" && existing.status && existing.status !== "run") {
            return s;
          }
          newState.set(id, {
            ...existing,
            status: data.state as string,
            duration: (data.duration as number) || 0,
            error: (data.error as string) || null,
            eeId: buf.eeId || existing.eeId,
            eeEmail: buf.eeEmail || existing.eeEmail,
            entityId: lastEntityIdRef.current || existing.entityId,
            products: buf.products || existing.products,
            countryProducts: buf.countryProducts || existing.countryProducts,
            questionnaireResult:
              buf.questionnaireResult !== null
                ? buf.questionnaireResult
                : existing.questionnaireResult,
            ir35Status: buf.ir35Status || existing.ir35Status,
            eligibility: buf.eligibility || existing.eligibility,
            corCodes: buf.corCodes || existing.corCodes,
          });
          return { ...s, testState: newState };
        });
        // Reset buffer
        bufferRef.current = {
          eeId: null, eeEmail: null, products: null,
          countryProducts: null, questionnaireResult: null,
          ir35Status: null, eligibility: null, corCodes: null,
        };
        break;
      }

      case "suite:end":
        setState((s) => ({
          ...s,
          status: "Complete",
          summary: {
            passed: (data.passed as number) || 0,
            failed: (data.failed as number) || 0,
            skipped: (data.skipped as number) || 0,
            duration: (data.duration as number) || 0,
          },
        }));
        break;

      case "suite:process-done":
        setState((s) => {
          // Clean up any tests stuck in "run" status (e.g. if test:result never arrived)
          const newState = new Map(s.testState);
          let changed = false;
          for (const [id, ts] of newState) {
            if (ts.status === "run") {
              newState.set(id, { ...ts, status: "skip" });
              changed = true;
            }
          }
          return { ...s, running: false, testState: changed ? newState : s.testState };
        });
        break;
    }
  }, []);

  const startRun = useCallback(async (testFilter?: string) => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    filteredRunRef.current = !!testFilter;
    filterIdRef.current = testFilter || null;

    setState((s) => ({
      ...s,
      running: true,
      status: testFilter ? `Running ${testFilter}...` : "Starting...",
      testState: testFilter ? s.testState : new Map(),
      summary: null,
    }));

    try {
      const companyHeaders = getCompanyHeaders();
      const response = await fetch("/api/suite/run", {
        method: "POST",
        headers: {
          ...(testFilter ? { "Content-Type": "application/json" } : {}),
          ...companyHeaders,
        },
        body: testFilter ? JSON.stringify({ testFilter }) : undefined,
        signal: abort.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as Record<string, string>).error || `HTTP ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop()!;

        for (const part of parts) {
          const eventMatch = part.match(/^event: (.+)$/m);
          const dataMatch = part.match(/^data: (.+)$/m);
          if (eventMatch && dataMatch) {
            try {
              handleEvent(eventMatch[1], JSON.parse(dataMatch[1]));
            } catch {
              // Skip malformed events
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setState((s) => ({
          ...s,
          status: `Error: ${(err as Error).message}`,
          running: false,
        }));
      }
    }
  }, [handleEvent]);

  const runSuite = useCallback(() => startRun(), [startRun]);
  const runTest = useCallback((testId: string) => startRun(testId), [startRun]);

  const loadLastRun = useCallback(async () => {
    try {
      const res = await fetch("/api/suite/last-run");
      if (!res.ok) return;
      const data = await res.json();
      if (data.tests) {
        const newState = new Map<string, TestState>();
        for (const [id, ts] of Object.entries(data.tests)) {
          newState.set(id, ts as TestState);
        }
        setState((s) => ({
          ...s,
          testState: newState,
          summary: data.summary || null,
          status: data.summary ? "Last run loaded" : "Ready",
        }));
      }
    } catch {
      // No previous run, that's fine
    }
  }, []);

  return { state, runSuite, runTest, loadLastRun, testMatrix: TEST_MATRIX };
}

// Utility: compare arrays for match/mismatch coloring
export function arrMatch(expected: string[], actual: string[]): boolean {
  if (expected.length !== actual.length) return false;
  const a = [...expected].sort();
  const b = [...actual].sort();
  return a.every((v, i) => v === b[i]);
}
