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
    return raw.terminals
      .filter(
        (t) =>
          filter.childrenOf === undefined || t.parent === filter.childrenOf,
      )
      .map(toTerminal);
  }

  async read(
    id: string,
    lines: number,
  ): Promise<{ text: string; complete: boolean } | TerminalError> {
    const raw = await this.#json(
      ["read", "--json", "--lines", String(lines), id],
      isHcRead,
    );
    return isError(raw) ? raw : { text: raw.text, complete: raw.complete };
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
    const stopped =
      "terminal" in target
        ? [raw.terminal]
        : raw.children
            .filter((c) => c.reason !== "running")
            .map((c) => c.terminal);
    const finished: Terminal[] = [];
    for (const id of stopped) {
      const terminal = await this.get(id);
      if (isError(terminal)) {
        return terminal;
      }
      finished.push(terminal);
    }
    return { finished };
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
