import type { Clock, FileSystem, IdSource } from "../runtime/index.js";
import {
  SCHEMA_VERSION,
  parseEvent,
  type EventInput,
  type Kind,
  type LedgerEvent,
  type Source,
} from "./schema.js";

export type RecordResult =
  | { ok: true; event: LedgerEvent }
  | { ok: false; field: string; message: string };

export interface ListFilter {
  session?: string;
  pane?: string;
  idea?: string;
  source?: Source;
  kind?: Kind;
  /** Inclusive lower bound on `occurredAt`. */
  since?: string;
  /** Exclusive upper bound on `occurredAt`. */
  until?: string;
}

export interface ListResult {
  events: LedgerEvent[];
  /** Lines that were not a valid stored event: torn writes, hand edits, old schemas. */
  skipped: number;
}

/** An append-only JSONL ledger of stage events at one path. */
export class Ledger {
  constructor(
    private readonly fs: FileSystem,
    private readonly clock: Clock,
    private readonly ids: IdSource,
    readonly path: string,
  ) {}

  /** Validates one event, then appends it as one line with a single write. */
  async record(input: unknown): Promise<RecordResult> {
    const parsed = parseEvent(input, "input");
    if (!parsed.ok) {
      return parsed;
    }
    const given = parsed.event as EventInput;
    const event: LedgerEvent = {
      ...given,
      schema: SCHEMA_VERSION,
      id: given.id ?? this.ids.next(),
      recordedAt: this.clock.now().toISOString(),
    };
    await this.fs.appendFile(this.path, `${JSON.stringify(event)}\n`);
    return { ok: true, event };
  }

  async list(filter: ListFilter): Promise<ListResult> {
    const text = await this.read();
    const events: LedgerEvent[] = [];
    let skipped = 0;
    for (const line of text.split("\n")) {
      if (line === "") {
        continue;
      }
      const event = parseLine(line);
      if (event === undefined) {
        skipped += 1;
      } else if (matches(event, filter)) {
        events.push(event);
      }
    }
    return { events, skipped };
  }

  private async read(): Promise<string> {
    try {
      return await this.fs.readFile(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }
}

function parseLine(line: string): LedgerEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = parseEvent(value, "stored");
  return parsed.ok ? (parsed.event as LedgerEvent) : undefined;
}

function matches(event: LedgerEvent, filter: ListFilter): boolean {
  return (
    (filter.session === undefined || event.session === filter.session) &&
    (filter.pane === undefined || event.pane === filter.pane) &&
    (filter.idea === undefined || event.idea === filter.idea) &&
    (filter.source === undefined || event.source === filter.source) &&
    (filter.kind === undefined || event.kind === filter.kind) &&
    (filter.since === undefined ||
      Date.parse(event.occurredAt) >= Date.parse(filter.since)) &&
    (filter.until === undefined ||
      Date.parse(event.occurredAt) < Date.parse(filter.until))
  );
}
