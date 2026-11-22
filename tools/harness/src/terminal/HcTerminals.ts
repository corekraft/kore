import type { Runner } from "../runtime/index.js";
import { refuseRun } from "./hc-argv.js";
import { hcFailure } from "./hc-errors.js";
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

/** The fields of hc's JSON for one terminal that this adapter reads. */
interface HcTerminal {
  address: string;
  name?: string | null;
  parent?: string | null;
  state: "live" | "finished";
  status?: string | null;
  exit_code?: number | null;
  labels: Record<string, string>;
  cwd: string;
}

/** The fields of hc's wait JSON that this adapter reads. */
interface HcWait {
  terminal: string;
  ended: boolean;
  reason: string;
  children: { terminal: string; reason: string }[];
}

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
    const raw = await this.#json<HcTerminal>([
      "run",
      "--json",
      "--bg",
      ...(spec.name === undefined ? [] : ["--name", spec.name]),
      "--cwd",
      spec.cwd,
      ...labelPairs(spec.labels ?? {}).flatMap((pair) => ["--label", pair]),
      ...(spec.parent === undefined ? [] : ["--parent", spec.parent]),
      ...(spec.outliveParent === true ? ["--outlive-parent"] : []),
      "--",
      ...spec.argv,
    ]);
    return isError(raw) ? raw : { id: raw.address };
  }

  async get(id: string): Promise<Terminal | TerminalError> {
    const raw = await this.#json<HcTerminal>(["get", "--json", id]);
    return isError(raw) ? raw : toTerminal(raw);
  }

  async list(filter: ListFilter = {}): Promise<Terminal[] | TerminalError> {
    const raw = await this.#json<{ terminals: HcTerminal[] }>([
      "ls",
      "--json",
      "--all",
      ...labelPairs(filter.labels ?? {}).flatMap((pair) => ["--label", pair]),
    ]);
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
    const raw = await this.#json<{ text: string; complete: boolean }>([
      "read",
      "--json",
      "--lines",
      String(lines),
      id,
    ]);
    return isError(raw) ? raw : { text: raw.text, complete: raw.complete };
  }

  async send(
    id: string,
    text: string,
    opts: SendOptions = {},
  ): Promise<{ id: string } | TerminalError> {
    const raw = await this.#json<object>([
      "send",
      "--json",
      ...(opts.ifStatus === undefined ? [] : ["--if", opts.ifStatus]),
      "--",
      id,
      text,
    ]);
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
    const raw = await this.#json<HcWait>(["wait", "--json", ...scope]);
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
    const raw = await this.#json<object>(["interrupt", "--json", id]);
    return isError(raw) ? raw : { id };
  }

  async kill(id: string): Promise<{ id: string } | TerminalError> {
    const raw = await this.#json<object>(["kill", "--json", id]);
    return isError(raw) ? raw : { id };
  }

  async remove(id: string): Promise<{ id: string } | TerminalError> {
    const raw = await this.#json<{ removed: string }>(["rm", "--json", id]);
    return isError(raw) ? raw : { id: raw.removed };
  }

  async label(
    id: string,
    labels: Record<string, string>,
  ): Promise<{ id: string } | TerminalError> {
    const raw = await this.#json<object>([
      "label",
      "--json",
      id,
      ...labelPairs(labels),
    ]);
    return isError(raw) ? raw : { id };
  }

  /** hc events never ends, and a Runner returns only when its command ends, so this cannot stream. */
  events(): AsyncIterable<TerminalEvent> {
    throw new Error(
      "HcTerminals cannot follow events: a Runner returns only when its command ends, and hc events never ends. The ledger watch terminal reads them (plan 16, Step 4)",
    );
  }

  /** Runs one hc command with --json, after the version check, and parses its output. */
  async #json<T>(args: string[]): Promise<T | TerminalError> {
    const pinned = await checkHcVersion(this.#runner);
    if (pinned !== undefined) {
      return pinned;
    }
    const verb = args[0] ?? "hc";
    const result = await this.#runner.run("hc", args);
    if (result.code !== 0) {
      return hcFailure(verb, result);
    }
    try {
      return JSON.parse(result.stdout) as T;
    } catch {
      return terminalError(
        "unavailable",
        "hc " + verb + " printed output that is not JSON",
      );
    }
  }
}
