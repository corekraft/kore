import type { Runner } from "../runtime/index.js";
import { refuseRun } from "./hc-argv.js";
import { hcFailure } from "./hc-errors.js";
import {
  isHcList,
  isHcRead,
  isHcRemoved,
  isHcTerminal,
  isHcWait,
  isJsonObject,
  type HcTerminal,
} from "./hc-shapes.js";
import { checkHcVersion } from "./hc-version.js";
import {
  terminalError,
  type ListFilter,
  type RunSpec,
  type SendOptions,
  type Output,
  type Started,
  type Status,
  type Terminal,
  type TerminalError,
  type TerminalEvent,
  type Terminals,
  type Waited,
  type WaitTarget,
} from "./port.js";

/** What to check when hc prints a reply the adapter does not read. */
const SHAPE_HINT =
  "check hc --version against the pin in docs/operations/hc-pin.md";

export interface HcTerminalsOptions {
  runner: Runner;
  /** The caller's environment. HC_TERMINAL_ID is read from it, and nothing else. */
  env: Readonly<Record<string, string | undefined>>;
}

function isError(value: unknown): value is TerminalError {
  return typeof value === "object" && value !== null && "error" in value;
}

function labelPairs(labels: Readonly<Record<string, string>>): string[] {
  return Object.entries(labels).map(([key, value]) => key + "=" + value);
}

function toTerminal(raw: HcTerminal): Terminal {
  return {
    id: raw.address,
    state: raw.state,
    labels: { ...raw.labels },
    cwd: raw.cwd,
    ...(typeof raw.name === "string" ? { name: raw.name } : {}),
    ...(typeof raw.parent === "string" ? { parent: raw.parent } : {}),
    ...(typeof raw.status === "string" ? { status: raw.status as Status } : {}),
    ...(typeof raw.exit_code === "number" ? { exitCode: raw.exit_code } : {}),
  };
}

/**
 * The Terminals port over the hc CLI, through the injected Runner. Every call
 * passes --json and separate argv elements, and gives the Runner no env.
 */
export class HcTerminals implements Terminals {
  readonly #runner: Runner;
  readonly #env: Readonly<Record<string, string | undefined>>;

  constructor(options: HcTerminalsOptions) {
    this.#runner = options.runner;
    this.#env = options.env;
  }

  self(): string | undefined {
    return this.#env.HC_TERMINAL_ID;
  }

  async run(spec: RunSpec): Promise<Started | TerminalError> {
    const refusal = refuseRun(spec);
    if (refusal !== undefined) {
      return refusal;
    }
    const parent = await this.#parentLive(spec.parent);
    if (parent !== undefined) {
      return parent;
    }
    const raw = await this.#json(
      [
        "run",
        "--json",
        "--bg",
        ...(spec.name === undefined ? [] : ["--name", spec.name]),
        "--cwd",
        spec.cwd,
        ...labelPairs(spec.labels ?? {}).flatMap((pair) => ["--label", pair]),
        ...(spec.parent === undefined ? [] : ["--parent", spec.parent]),
        ...(spec.outliveParent === true ? ["--outlive-parent"] : []),
        ...(spec.notify === false ? ["--no-notify"] : []),
        "--",
        ...spec.argv,
      ],
      isHcTerminal,
    );
    return isError(raw) ? raw : { id: raw.address };
  }

  async get(id: string): Promise<Terminal | TerminalError> {
    const raw = await this.#json(["get", "--json", id], isHcTerminal);
    return isError(raw) ? raw : toTerminal(raw);
  }

  /** The listing carries no labels, so each terminal it names is read with get. */
  async list(filter: ListFilter = {}): Promise<Terminal[] | TerminalError> {
    const raw = await this.#json(
      [
        "ls",
        "--json",
        "--all",
        ...labelPairs(filter.labels ?? {}).flatMap((pair) => ["--label", pair]),
      ],
      isHcList,
    );
    if (isError(raw)) {
      return raw;
    }
    const found: Terminal[] = [];
    for (const row of raw.terminals) {
      if (filter.childrenOf === undefined || row.parent === filter.childrenOf) {
        const terminal = await this.get(row.address);
        if (isError(terminal)) {
          return terminal;
        }
        found.push(terminal);
      }
    }
    return found;
  }

  async read(id: string, lines: number): Promise<Output | TerminalError> {
    const raw = await this.#json(
      ["read", "--json", "--lines", String(lines), id],
      isHcRead,
    );
    return isError(raw) ? raw : { text: raw.text };
  }

  async send(
    id: string,
    text: string,
    opts: SendOptions = {},
  ): Promise<{ id: string } | TerminalError> {
    const raw = await this.#json(
      [
        "send",
        "--json",
        ...(opts.ifStatus === undefined ? [] : ["--if", opts.ifStatus]),
        "--",
        id,
        text,
      ],
      isJsonObject,
    );
    return isError(raw) ? raw : { id };
  }

  async wait(
    target: WaitTarget,
    timeoutMs: number,
  ): Promise<Waited | TerminalError> {
    const seconds = String(Math.ceil(timeoutMs / 1000));
    const scope =
      "terminal" in target
        ? ["--timeout", seconds, target.terminal]
        : ["--children", target.children, "--timeout", seconds, target.of];
    const raw = await this.#json(["wait", "--json", ...scope], isHcWait);
    if (isError(raw)) {
      return raw;
    }
    if (!raw.ended) {
      return raw.reason === "timeout"
        ? terminalError(
            "timeout",
            "nothing has finished within " + timeoutMs + " ms",
            "wait longer, or check the terminal with get()",
          )
        : terminalError(
            "unavailable",
            "wait stopped without a finished terminal (reason " +
              raw.reason +
              ")",
          );
    }
    if ("terminal" in target) {
      const finished = await this.#terminals([raw.terminal]);
      return isError(finished) ? finished : { finished };
    }
    // hc names a child in its reply only when the news arrives while the wait runs,
    // so the stopped children are read from the listing (finished ones, not news).
    const children = await this.list({ childrenOf: target.of });
    if (isError(children)) {
      return children;
    }
    return { finished: children.filter((c) => c.state === "finished") };
  }

  async interrupt(id: string): Promise<{ id: string } | TerminalError> {
    const raw = await this.#json(["interrupt", "--json", id], isJsonObject);
    return isError(raw) ? raw : { id };
  }

  async kill(id: string): Promise<{ id: string } | TerminalError> {
    const raw = await this.#json(["kill", "--json", id], isJsonObject);
    return isError(raw) ? raw : { id };
  }

  async remove(id: string): Promise<{ id: string } | TerminalError> {
    const raw = await this.#json(["rm", "--json", id], isHcRemoved);
    return isError(raw) ? raw : { id: raw.removed };
  }

  async label(
    id: string,
    labels: Record<string, string>,
  ): Promise<{ id: string } | TerminalError> {
    const raw = await this.#json(
      ["label", "--json", id, ...labelPairs(labels)],
      isJsonObject,
    );
    return isError(raw) ? raw : { id };
  }

  /** hc events never ends, and a Runner returns only when its command ends, so this cannot stream. */
  events(): AsyncIterable<TerminalEvent> {
    throw new Error(
      "HcTerminals cannot follow events: a Runner returns only when its command ends, and hc events never ends. The ledger watch terminal reads them (plan 16, Step 4)",
    );
  }

  /** hc starts a child of a finished parent live, and never ends it, so the parent must be live first. */
  async #parentLive(
    parent: string | undefined,
  ): Promise<TerminalError | undefined> {
    if (parent === undefined) {
      return undefined;
    }
    const found = await this.get(parent);
    if (isError(found)) {
      return found;
    }
    return found.state === "live"
      ? undefined
      : terminalError(
          "not-live",
          parent + " has finished",
          "a finished terminal takes no children; start the child under a live parent",
        );
  }

  async #terminals(ids: string[]): Promise<Terminal[] | TerminalError> {
    const found: Terminal[] = [];
    for (const id of ids) {
      const terminal = await this.get(id);
      if (isError(terminal)) {
        return terminal;
      }
      found.push(terminal);
    }
    return found;
  }

  /**
   * Runs one hc command with --json, after the version check. The reply must
   * parse and have the shape the adapter reads, or the error names the shape.
   */
  async #json<T>(
    args: string[],
    shape: (value: unknown) => value is T,
  ): Promise<T | TerminalError> {
    const pinned = await checkHcVersion(this.#runner);
    if (pinned !== undefined) {
      return pinned;
    }
    const verb = args[0] ?? "hc";
    const result = await this.#runner.run("hc", args);
    if (result.code !== 0) {
      return hcFailure(verb, result);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return terminalError(
        "unavailable",
        "hc " + verb + " printed output that is not JSON",
      );
    }
    if (!shape(parsed)) {
      return terminalError(
        "unavailable",
        "hc " + verb + " printed JSON of an unexpected shape",
        SHAPE_HINT,
      );
    }
    return parsed;
  }
}
