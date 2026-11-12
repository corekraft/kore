import { resolve } from "node:path";
import {
  KINDS,
  Ledger,
  pollHerdr,
  SOURCES,
  isTimestamp,
  type Kind,
  type LedgerEvent,
  type ListFilter,
  type Source,
} from "../ledger/index.js";
import {
  mainRoot,
  type Command,
  type CommandContext,
} from "../runtime/index.js";

/** Relative to the main checkout root: the git-ignored state directory shared with the kore journal. */
const DEFAULT_LEDGER = ".kore/state/ledger.jsonl";

const EVENT_FLAGS = [
  "id",
  "source",
  "kind",
  "occurred-at",
  "session",
  "pane",
  "agent",
  "idea",
  "stage",
  "tool",
  "outcome",
  "label",
  "number",
] as const;

const STRING_FLAGS = (names: readonly string[]) =>
  Object.fromEntries(names.map((n) => [n, "string" as const]));

const camel = (flag: string) =>
  flag.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

const NO_ROOT =
  "Cannot find the main checkout root for the shared ledger. Run inside the repository, set KORE_ROOT to its root, or pass --ledger <path>.";

export type Opened = { ledger: Ledger } | { error: string };

/**
 * One ledger is shared by every worktree: <main checkout root>/.kore/state/ledger.jsonl.
 * The main root is the parent of git's common dir, so a subdirectory or a linked
 * worktree resolves to the same file. KORE_ROOT overrides; --ledger is cwd-relative.
 */
async function ledgerPath({
  deps,
  options,
}: CommandContext): Promise<string | undefined> {
  const given = options["ledger"];
  if (typeof given === "string") {
    return resolve(deps.cwd, given);
  }
  const main = await mainRoot(deps);
  return main === undefined ? undefined : resolve(main, DEFAULT_LEDGER);
}

export async function openLedger(context: CommandContext): Promise<Opened> {
  const path = await ledgerPath(context);
  if (path === undefined) {
    return { error: NO_ROOT };
  }
  const { deps } = context;
  return { ledger: new Ledger(deps.fs, deps.clock, deps.ids, path) };
}

type Input = { input: unknown } | { error: string; code?: number };

/** Builds an event from flags, or from JSON on stdin when no event flag is given. */
async function eventInput(context: CommandContext): Promise<Input> {
  const given = EVENT_FLAGS.filter((f) => context.options[f] !== undefined);
  if (given.length > 0) {
    return {
      input: Object.fromEntries(
        given.map((f) => {
          const value = String(context.options[f]);
          // A number flag arrives as text; anything but digits is left for the schema to reject.
          const isCount = f === "number" && /^\d+$/.test(value);
          return [camel(f), isCount ? Number(value) : value];
        }),
      ),
    };
  }
  const text = await context.deps.stdin();
  if (text.trim() === "") {
    return {
      error:
        "No event given. Pass --source, --kind and --occurred-at, or one JSON event on stdin.",
      code: 2,
    };
  }
  try {
    return { input: JSON.parse(text) as unknown };
  } catch {
    return { error: "Invalid event: stdin is not valid JSON." };
  }
}

function reject(
  { json, deps }: CommandContext,
  message: string,
  field: string,
  code = 1,
): number {
  deps.stderr(
    json ? `${JSON.stringify({ error: message, field })}\n` : `${message}\n`,
  );
  return code;
}

const record: Command = {
  summary:
    "append one validated event, from flags or JSON on stdin, to the stage ledger",
  options: STRING_FLAGS([...EVENT_FLAGS, "ledger"]),
  async run(context) {
    const given = await eventInput(context);
    if ("error" in given) {
      return reject(context, given.error, "event", given.code);
    }
    const opened = await openLedger(context);
    if ("error" in opened) {
      return reject(context, opened.error, "ledger");
    }
    const result = await opened.ledger.record(given.input);
    if (!result.ok) {
      return reject(context, result.message, result.field);
    }
    context.deps.stdout(
      context.json
        ? `${JSON.stringify({ event: result.event })}\n`
        : `recorded ${result.event.id} ${result.event.kind}\n`,
    );
    return 0;
  },
};

type Filtered = { filter: ListFilter } | { error: string };

function filterFrom(options: CommandContext["options"]): Filtered {
  const filter: ListFilter = {};
  const text = (name: string) => {
    const value = options[name];
    return typeof value === "string" ? value : undefined;
  };
  for (const name of ["session", "pane", "idea"] as const) {
    const value = text(name);
    if (value !== undefined) {
      filter[name] = value;
    }
  }
  const source = text("source");
  if (source !== undefined) {
    if (!SOURCES.includes(source as Source)) {
      return {
        error: `Invalid --source "${source}". Sources: ${SOURCES.join(", ")}.`,
      };
    }
    filter.source = source as Source;
  }
  const kind = text("kind");
  if (kind !== undefined) {
    if (!KINDS.includes(kind as Kind)) {
      return { error: `Invalid --kind "${kind}". Kinds: ${KINDS.join(", ")}.` };
    }
    filter.kind = kind as Kind;
  }
  for (const name of ["since", "until"] as const) {
    const value = text(name);
    if (value !== undefined) {
      if (!isTimestamp(value)) {
        return {
          error: `Invalid --${name} "${value}". Use an ISO 8601 UTC time such as 2026-01-02T03:04:05Z.`,
        };
      }
      filter[name] = value;
    }
  }
  return { filter };
}

function line(event: LedgerEvent): string {
  const where = [event.session, event.pane, event.idea].filter(
    (v) => v !== undefined,
  );
  return [event.occurredAt, event.source, event.kind, ...where].join(" ");
}

const list: Command = {
  summary:
    "list stage events, filtered by session, pane, idea, source, kind and time range (--since inclusive, --until exclusive, on occurredAt)",
  options: STRING_FLAGS([
    "session",
    "pane",
    "idea",
    "source",
    "kind",
    "since",
    "until",
    "ledger",
  ]),
  async run(context) {
    const parsed = filterFrom(context.options);
    if ("error" in parsed) {
      return reject(context, parsed.error, "filter", 2);
    }
    const opened = await openLedger(context);
    if ("error" in opened) {
      return reject(context, opened.error, "ledger");
    }
    const { events, skipped } = await opened.ledger.list(parsed.filter);
    if (context.json) {
      context.deps.stdout(`${JSON.stringify({ events, skipped })}\n`);
      return 0;
    }
    context.deps.stdout(events.map((e) => `${line(e)}\n`).join(""));
    if (skipped > 0) {
      context.deps.stdout(`skipped ${skipped} malformed ledger line(s)\n`);
    }
    return 0;
  },
};

const pollHerdrCommand: Command = {
  summary:
    "read herdr's agent panes once and append only the changes (pane.spawned, pane.busy, pane.waiting, pane.closed) to the ledger; pane.closed means the pane no longer hosts an agent; safe to repeat from a wait loop, and one poll runs at a time",
  options: STRING_FLAGS(["ledger"]),
  async run(context) {
    const opened = await openLedger(context);
    if ("error" in opened) {
      return reject(context, opened.error, "ledger");
    }
    const { runner, clock, fs } = context.deps;
    const result = await pollHerdr({
      ledger: opened.ledger,
      runner,
      clock,
      fs,
    });
    if (!result.ok) {
      return reject(context, result.message, "herdr");
    }
    context.deps.stdout(
      context.json
        ? `${JSON.stringify({ recorded: result.recorded, events: result.events })}\n`
        : `recorded ${result.recorded} herdr event(s)\n`,
    );
    return 0;
  },
};

export const ledgerCommands: Record<string, Command> = {
  record,
  list,
  "poll-herdr": pollHerdrCommand,
};
