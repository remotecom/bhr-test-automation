"use client";

import { useState, useCallback, useRef } from "react";
import { LIFECYCLE_MATRIX, type LifecycleTestCase } from "@/data/lifecycle-matrix";
import { getCompanyHeaders } from "@/components/CompanySelector";
import { getEnvironmentHeaders } from "@/components/EnvironmentSelector";

export interface TransitionState {
  step: string;
  action: string | null;
  expectedStatus: string;
  actualStatus?: string;
  durationMs?: number;
  state: "pending" | "running" | "pass" | "fail";
  error?: string;
}

export interface WebhookState {
  expected: string[];
  received: string[];
  missing: string[];
  extra: string[];
  passed: boolean;
}

export interface LifecycleTestState {
  status?: string;
  duration?: number;
  eeId?: string;
  entityId?: string;
  error?: string | null;
  transitions: TransitionState[];
  webhooks?: WebhookState;
}

export interface LifecycleSummary {
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}

export interface LifecycleState {
  running: boolean;
  status: string;
  testState: Map<string, LifecycleTestState>;
  summary: LifecycleSummary | null;
  lastEntityId: string | null;
  webhooksAvailable: boolean;
}

export function useLifecycle() {
  const [state, setState] = useState<LifecycleState>({
    running: false,
    status: "Ready",
    testState: new Map(),
    summary: null,
    lastEntityId: null,
    webhooksAvailable: false,
  });
  const abortRef = useRef<AbortController | null>(null);
  const filteredRunRef = useRef(false);
  const filterIdRef = useRef<string | null>(null);

  // Buffers for data between events
  const bufferRef = useRef({
    eeId: null as string | null,
    entityId: null as string | null,
  });

  const handleEvent = useCallback((event: string, data: Record<string, unknown>) => {
    const buf = bufferRef.current;

    switch (event) {
      case "lifecycle:start":
        setState((s) => ({
          ...s,
          status: "Running...",
          testState: filteredRunRef.current ? s.testState : new Map(),
          summary: null,
          webhooksAvailable: !!data.webhooksAvailable,
        }));
        bufferRef.current = { eeId: null, entityId: null };
        break;

      case "lifecycle:collected":
        setState((s) => {
          const newState = new Map(s.testState);
          const tests = data.tests as Array<{ testId: string; name: string }> | undefined;
          if (tests) {
            for (const entry of tests) {
              const id = entry.testId;
              if (id && (!filteredRunRef.current || id === filterIdRef.current)) {
                newState.set(id, {
                  ...newState.get(id),
                  status: "run",
                  transitions: [],
                });
              }
            }
          }
          const count = filteredRunRef.current ? 1 : (tests?.length || 0);
          return { ...s, testState: newState, status: `Running ${count} tests...` };
        });
        break;

      case "employment":
        buf.eeId = data.id as string;
        break;

      case "entity:swap":
        buf.entityId = data.entityId as string;
        setState((s) => ({ ...s, lastEntityId: data.entityId as string }));
        break;

      case "lifecycle:transition": {
        const testId = data.testId as string;
        setState((s) => {
          const newState = new Map(s.testState);
          const existing = newState.get(testId) || { status: "run", transitions: [] };
          const transitions = [...existing.transitions];

          const idx = data.index as number;
          const transitionState: TransitionState = {
            step: data.step as string,
            action: (data.action as string | null) || null,
            expectedStatus: (data.expectedStatus as string) || "",
            actualStatus: data.actualStatus as string | undefined,
            durationMs: data.durationMs as number | undefined,
            state: data.status as "pending" | "running" | "pass" | "fail",
            error: data.error as string | undefined,
          };

          // Update or append
          if (idx < transitions.length) {
            transitions[idx] = transitionState;
          } else {
            transitions.push(transitionState);
          }

          newState.set(testId, { ...existing, transitions });
          return { ...s, testState: newState };
        });
        break;
      }

      case "lifecycle:webhook": {
        const testId = data.testId as string;
        setState((s) => {
          const newState = new Map(s.testState);
          const existing = newState.get(testId) || { status: "run", transitions: [] };
          newState.set(testId, {
            ...existing,
            webhooks: {
              expected: data.expected as string[],
              received: data.received as string[],
              missing: data.missing as string[],
              extra: data.extra as string[],
              passed: data.passed as boolean,
            },
          });
          return { ...s, testState: newState };
        });
        break;
      }

      case "test:result": {
        const id = data.testId as string;
        setState((s) => {
          const newState = new Map(s.testState);
          const existing = newState.get(id) || { transitions: [] };
          newState.set(id, {
            ...existing,
            status: data.state as string,
            duration: (data.duration as number) || 0,
            error: (data.error as string) || null,
            eeId: buf.eeId || existing.eeId,
            entityId: buf.entityId || existing.entityId,
          });
          return { ...s, testState: newState };
        });
        bufferRef.current = { eeId: null, entityId: null };
        break;
      }

      case "lifecycle:end":
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

      case "lifecycle:process-done":
        setState((s) => ({ ...s, running: false }));
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
      const customHeaders = { ...getCompanyHeaders(), ...getEnvironmentHeaders() };
      const response = await fetch("/api/lifecycle/run", {
        method: "POST",
        headers: {
          ...(testFilter ? { "Content-Type": "application/json" } : {}),
          ...customHeaders,
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

  const runAll = useCallback(() => startRun(), [startRun]);
  const runTest = useCallback((testId: string) => startRun(testId), [startRun]);

  return { state, runAll, runTest, lifecycleMatrix: LIFECYCLE_MATRIX };
}
