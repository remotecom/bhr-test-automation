"use client";

import { useState, useCallback, useRef } from "react";

export interface TraceEntry {
  type: "step" | "side" | "done" | "error";
  label: string;
  ts: number;
}

export interface Subscription {
  product?: { short_name?: string } | string;
  price?: { amount?: number };
}

export interface PlaygroundResult {
  employmentId?: string;
  entityId?: string;
  products?: string[];
  selectedProduct?: string;
  invited?: boolean;
  inviteType?: string;
  stoppedAt?: string;
  stoppedReason?: string;
  subscriptions?: Subscription[];
  eligibility?: {
    standard: boolean;
    plus: boolean;
    cor: boolean;
    cor_supported_country_codes?: string[];
  };
}

export interface PlaygroundState {
  running: boolean;
  trace: TraceEntry[];
  result: PlaygroundResult | null;
  error: string | null;
  lastEmploymentId: string | null;
  contractorCountry: string;
  currentEntityName: string | null;
}

const initialState: PlaygroundState = {
  running: false,
  trace: [],
  result: null,
  error: null,
  lastEmploymentId: null,
  contractorCountry: "",
  currentEntityName: null,
};

export function usePlayground() {
  const [state, setState] = useState<PlaygroundState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const addTrace = useCallback((type: TraceEntry["type"], label: string) => {
    setState((s) => ({
      ...s,
      trace: [...s.trace, { type, label, ts: Date.now() }],
    }));
  }, []);

  const handleEvent = useCallback(
    (event: string, data: Record<string, unknown>) => {
      switch (event) {
        case "playground:start":
          if (data.contractorCountry) {
            setState((s) => ({
              ...s,
              contractorCountry: data.contractorCountry as string,
            }));
          }
          addTrace("step", "Playground run started");
          break;

        case "playground:entity-swap":
          setState((s) => ({
            ...s,
            currentEntityName: data.entityName as string,
          }));
          break;

        case "playground:step":
          addTrace(data.side ? "side" : "step", data.label as string);
          break;

        case "playground:eligibility":
          if ((data as Record<string, unknown>).error) {
            addTrace("side", "// Eligibility: failed (non-blocking)");
          } else {
            const corCodes = (data.cor_supported_country_codes as string[]) || [];
            setState((s) => {
              const corForCountry = s.contractorCountry
                ? corCodes.includes(s.contractorCountry)
                : false;
              const products = [
                data.standard && "CM",
                data.plus && "CM+",
                corForCountry && "COR",
              ].filter(Boolean);
              const entityId = (data.entityId as string) || "";
              addTrace(
                "side",
                `// Eligibility: [${products.join(", ")}] (entity ${entityId.slice(0, 8)}...)`
              );
              return {
                ...s,
                result: {
                  ...s.result,
                  eligibility: data as PlaygroundResult["eligibility"],
                },
              };
            });
          }
          break;

        case "playground:product-unavailable":
          addTrace("error", `${data.requested} not available. Available: ${(data.available as string[])?.join(", ") || "none"}`);
          break;

        case "playground:done": {
          const result = data as unknown as PlaygroundResult;
          setState((s) => ({
            ...s,
            result: { ...s.result, ...result },
            lastEmploymentId: result.employmentId || s.lastEmploymentId,
          }));
          if (result.stoppedAt) {
            addTrace("error", result.stoppedReason || "Stopped");
          } else if (result.invited) {
            addTrace(
              "done",
              `Full flow complete! ${result.inviteType === "cor-reserve" ? "COR reserve created" : "Contractor invited"}`
            );
          } else {
            addTrace("done", `Done! Products: ${(result.products || []).join(", ") || "(none)"}`);
          }
          break;
        }

        case "playground:error":
          setState((s) => ({ ...s, error: data.message as string || data.error as string }));
          addTrace("error", (data.message as string) || (data.error as string));
          break;

        case "playground:cancelled":
          addTrace("done", `Employment ${(data.employmentId as string)?.slice(0, 8)}... cancelled`);
          break;
      }
    },
    [addTrace]
  );

  const run = useCallback(
    async (config: Record<string, unknown>) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setState((s) => ({
        ...s,
        running: true,
        trace: [],
        result: null,
        error: null,
      }));

      try {
        const response = await fetch("/api/playground/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
          signal: abort.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
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
            error: (err as Error).message,
          }));
          addTrace("error", `Stream error: ${(err as Error).message}`);
        }
      } finally {
        setState((s) => ({ ...s, running: false }));
      }
    },
    [handleEvent, addTrace]
  );

  const cancel = useCallback(async () => {
    if (!state.lastEmploymentId) return;

    try {
      await fetch("/api/playground/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employmentId: state.lastEmploymentId }),
      });
      addTrace("done", `Cancelled employment ${state.lastEmploymentId.slice(0, 8)}...`);
      setState((s) => ({ ...s, lastEmploymentId: null }));
    } catch {
      addTrace("error", "Cancel failed");
    }
  }, [state.lastEmploymentId, addTrace]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(initialState);
  }, []);

  return { state, run, cancel, reset };
}
