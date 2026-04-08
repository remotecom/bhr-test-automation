/**
 * Custom Vitest reporter — live trace view + dashboard SSE events.
 */

import type { Reporter, File, Task, TaskResultPack } from "vitest";
import { emit } from "./dashboard/emit";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function extractTestId(name: string): string {
  const match = name.match(/^([A-Z]\d+(?:\([^)]+\))?)/);
  return match ? match[1] : "";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Recursively collect all test tasks from suites */
function collectTests(tasks: Task[]): Task[] {
  const result: Task[] = [];
  for (const t of tasks) {
    if (t.type === "test") {
      result.push(t);
    } else if (t.type === "suite" && t.tasks) {
      result.push(...collectTests(t.tasks));
    }
  }
  return result;
}

export default class TraceReporter implements Reporter {
  private startTime = 0;
  private passed = 0;
  private failed = 0;
  private skipped = 0;
  private taskMap = new Map<string, { name: string; testId: string }>();

  onInit() {
    this.startTime = Date.now();
    console.error(
      `\n${BOLD}${CYAN}━━━ BHR Test Automation ━━━${RESET}  ${DIM}${new Date().toLocaleTimeString()}${RESET}\n`
    );
    emit("suite:start", { time: new Date().toISOString() });
  }

  onCollected(files?: File[]) {
    if (!files) return;

    // Build task ID → name map and collect test list for dashboard
    const testList: { testId: string; name: string }[] = [];
    for (const file of files) {
      const tests = collectTests(file.tasks || []);
      for (const t of tests) {
        const testId = extractTestId(t.name) || t.id;
        this.taskMap.set(t.id, { name: t.name, testId });
        testList.push({ testId, name: t.name });
      }
    }

    const total = testList.length;
    console.error(`${DIM}Collected ${total} tests across ${files.length} files${RESET}\n`);
    emit("suite:collected", { total, files: files.length, tests: testList });
  }

  onTaskUpdate(packs: TaskResultPack[]) {
    for (const [id, result] of packs) {
      if (!result) continue;
      const info = this.taskMap.get(id);
      if (!info) continue;

      if (result.state === "pass" || result.state === "fail" || result.state === "skip") {
        const errorMsg =
          result.state === "fail" && result.errors?.[0]
            ? typeof result.errors[0] === "string"
              ? result.errors[0]
              : (result.errors[0] as any).message || ""
            : undefined;

        emit("test:result", {
          name: info.name,
          testId: info.testId,
          state: result.state,
          duration: result.duration ?? 0,
          error: errorMsg,
        });
      }
    }
  }

  onFinished(files?: File[], errors?: unknown[]) {
    if (!files) return;

    console.error("");

    for (const file of files) {
      const tests = collectTests(file.tasks || []);
      if (tests.length === 0) continue;

      // Print suite headers from top-level suites
      for (const task of file.tasks || []) {
        if (task.type === "suite") {
          console.error(`${BOLD}${task.name}${RESET}`);
          break;
        }
      }

      for (const t of tests) {
        const testId = extractTestId(t.name);
        const duration = t.result?.duration ?? 0;
        const state = t.result?.state;

        if (state === "pass") {
          this.passed++;
          console.error(
            `  ${GREEN}✓${RESET} ${testId ? `${BOLD}[${testId}]${RESET} ` : ""}${t.name}  ${DIM}${formatDuration(duration)}${RESET}`
          );
        } else if (state === "fail") {
          this.failed++;
          console.error(
            `  ${RED}✗${RESET} ${testId ? `${BOLD}[${testId}]${RESET} ` : ""}${t.name}  ${DIM}${formatDuration(duration)}${RESET}`
          );
          const err = t.result?.errors?.[0];
          if (err) {
            const msg =
              typeof err === "string"
                ? err
                : (err as any).message || JSON.stringify(err);
            console.error(`    ${RED}${msg}${RESET}`);
          }
        } else if (state === "skip") {
          this.skipped++;
          console.error(
            `  ${YELLOW}○${RESET} ${testId ? `[${testId}] ` : ""}${t.name}  ${DIM}skipped${RESET}`
          );
        }
      }
      console.error("");
    }

    const elapsed = Date.now() - this.startTime;
    const parts: string[] = [];
    if (this.passed) parts.push(`${GREEN}${this.passed} passed${RESET}`);
    if (this.failed) parts.push(`${RED}${this.failed} failed${RESET}`);
    if (this.skipped) parts.push(`${YELLOW}${this.skipped} skipped${RESET}`);

    console.error(
      `${BOLD}${CYAN}━━━ Summary ━━━${RESET}  ${parts.join("  ")}  ${DIM}(${formatDuration(elapsed)})${RESET}\n`
    );

    emit("suite:end", {
      passed: this.passed,
      failed: this.failed,
      skipped: this.skipped,
      duration: elapsed,
    });

    if (errors?.length) {
      console.error(`${RED}Unhandled errors:${RESET}`);
      for (const err of errors) {
        console.error(err);
      }
    }
  }
}
