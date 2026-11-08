// Docs: infra/plans/6-agent-primitives.md#journal-format
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CommandError,
  type RunOptions,
  type RunResult,
  type Runner,
} from "./runner.js";

export type JournalEntry =
  | {
      ts: string;
      op: string;
      kind: "start";
      environment: string;
      command: string;
      context?: string;
    }
  | {
      ts: string;
      op: string;
      kind: "exec";
      command: string;
      args: string[];
      code: number;
      ms: number;
    }
  | {
      ts: string;
      op: string;
      kind: "end";
      outcome: "ok" | "failed";
      error?: string;
      ms: number;
    };

type EntryBody = JournalEntry extends infer E
  ? E extends JournalEntry
    ? Omit<E, "ts" | "op">
    : never
  : never;

export interface JournalOperation {
  root: string;
  environment: string;
  command: string;
  context?: string;
}

export interface OperationSummary {
  op: string;
  command: string;
  ts: string;
  outcome: "ok" | "failed" | "interrupted";
  ms?: number;
  error?: string;
}

const sensitiveFlag = /password|secret|token|key/i;
const redacted = "<redacted>";
const maxErrorLength = 200;

function journalPath(root: string, environment: string): string {
  return join(root, ".kore", "state", "journal", `${environment}.jsonl`);
}

const sensitivePair =
  /(^|[,;\s])([^=,;\s]*(?:password|secret|token|key)[^=,;\s]*)=[\s\S]*/i;

/** Keeps `<k>=` and redacts the rest when `<k>` looks secret-bearing. */
function redactPair(text: string): string {
  return text.replace(sensitivePair, `$1$2=${redacted}`);
}

/** Redacts secret-looking flag values and secret-looking key=value tokens. */
export function redactArgs(args: readonly string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const item = args[index]!;
    if (!item.startsWith("--")) {
      result.push(redactPair(item));
      continue;
    }
    const equals = item.indexOf("=");
    const name = equals > 2 ? item.slice(2, equals) : item.slice(2);
    if (equals > 2) {
      result.push(
        sensitiveFlag.test(name)
          ? `${item.slice(0, equals)}=${redacted}`
          : `${item.slice(0, equals)}=${redactPair(item.slice(equals + 1))}`,
      );
      continue;
    }
    result.push(item);
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      result.push(sensitiveFlag.test(name) ? redacted : redactPair(next));
      index++;
    }
  }
  return result;
}

async function append(
  root: string,
  environment: string,
  op: string,
  body: EntryBody,
): Promise<void> {
  const path = journalPath(root, environment);
  await mkdir(join(root, ".kore", "state", "journal"), { recursive: true });
  const entry = { ts: new Date().toISOString(), op, ...body };
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}

async function appendOrWarn(
  root: string,
  environment: string,
  op: string,
  body: EntryBody,
): Promise<void> {
  try {
    await append(root, environment, op, body);
  } catch (error) {
    console.warn(
      `warning: could not write the operations journal: ${describe(error)}`,
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureText(error: unknown): string {
  const text =
    error instanceof CommandError
      ? `${error.command} ${redactArgs(error.args).join(" ")} failed (${error.result.code})`
      : redactPair(describe(error).split("\n")[0] ?? "");
  return (text.split("\n")[0] ?? "").slice(0, maxErrorLength);
}

/** Reads every entry for an environment; a missing journal is empty and malformed lines are skipped. */
export async function readJournal(
  root: string,
  environment: string,
): Promise<JournalEntry[]> {
  let text: string;
  try {
    text = await readFile(journalPath(root, environment), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const entries: JournalEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line) as JournalEntry;
      if (entry && typeof entry.op === "string") {
        entries.push(entry);
      }
    } catch {
      // A torn or foreign line must not hide the rest of the journal.
    }
  }
  return entries;
}

/** One summary per operation in journal order; a start with no end is interrupted. */
export function summarizeOperations(
  entries: readonly JournalEntry[],
): OperationSummary[] {
  const operations = new Map<string, OperationSummary>();
  for (const entry of entries) {
    if (entry.kind === "start") {
      operations.set(entry.op, {
        op: entry.op,
        command: entry.command,
        ts: entry.ts,
        outcome: "interrupted",
      });
    } else if (entry.kind === "end") {
      const operation = operations.get(entry.op);
      if (!operation) {
        continue;
      }
      operation.outcome = entry.outcome;
      operation.ms = entry.ms;
      if (entry.error !== undefined) {
        operation.error = entry.error;
      }
    }
  }
  return [...operations.values()];
}

/** Records one `exec` entry per command; never records `input` or `env`. */
export class JournalingRunner implements Runner {
  constructor(
    private readonly inner: Runner,
    private readonly target: { root: string; environment: string; op: string },
  ) {}

  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    const started = Date.now();
    const record = async (code: number): Promise<void> =>
      await appendOrWarn(
        this.target.root,
        this.target.environment,
        this.target.op,
        {
          kind: "exec",
          command,
          args: redactArgs(args),
          code,
          ms: Date.now() - started,
        },
      );
    try {
      const result = await this.inner.run(command, args, options);
      await record(result.code);
      return result;
    } catch (error) {
      await record(error instanceof CommandError ? error.result.code : -1);
      throw error;
    }
  }
}

/**
 * Journals one mutating operation. Fails closed: if the start entry cannot be
 * written the operation does not run. Later write failures only warn.
 */
export async function withJournal<T>(
  operation: JournalOperation,
  runner: Runner,
  work: (runner: Runner) => Promise<T>,
): Promise<T> {
  const op = randomUUID();
  const started = Date.now();
  try {
    await append(operation.root, operation.environment, op, {
      kind: "start",
      environment: operation.environment,
      command: operation.command,
      ...(operation.context ? { context: operation.context } : {}),
    });
  } catch (error) {
    throw new Error(
      `cannot write the operations journal, so ${operation.command} did not start: ${describe(error)}. Check that .kore/state is writable.`,
    );
  }
  const journaling = new JournalingRunner(runner, {
    root: operation.root,
    environment: operation.environment,
    op,
  });
  try {
    const result = await work(journaling);
    await appendOrWarn(operation.root, operation.environment, op, {
      kind: "end",
      outcome: "ok",
      ms: Date.now() - started,
    });
    return result;
  } catch (error) {
    await appendOrWarn(operation.root, operation.environment, op, {
      kind: "end",
      outcome: "failed",
      error: failureText(error),
      ms: Date.now() - started,
    });
    throw error;
  }
}
