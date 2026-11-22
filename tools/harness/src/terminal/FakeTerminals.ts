import {
  terminalError,
  type Done,
  type EventFilter,
  type ListFilter,
  type Output,
  type RunSpec,
  type SendOptions,
  type Sent,
  type Started,
  type Status,
  type Terminal,
  type TerminalError,
  type TerminalEvent,
  type Terminals,
  type Waited,
  type WaitTarget,
} from "./port.js";

/** A terminal as the fake models it: everything get reports, plus its output and input. */
interface Model {
  id: string;
  name?: string;
  parent?: string;
  state: "live" | "finished";
  status?: Status;
  exitCode?: number;
  labels: Record<string, string>;
  cwd: string;
  outliveParent: boolean;
  output: string;
  sent: string[];
}

/** Re-checks one pending wait; returns true once it has resolved, so the fake drops it. */
type Waiter = () => boolean;

function viewOf(model: Model): Terminal {
  return {
    id: model.id,
    state: model.state,
    labels: { ...model.labels },
    cwd: model.cwd,
    ...(model.name === undefined ? {} : { name: model.name }),
    ...(model.parent === undefined ? {} : { parent: model.parent }),
    ...(model.status === undefined ? {} : { status: model.status }),
    ...(model.exitCode === undefined ? {} : { exitCode: model.exitCode }),
  };
}

function notFound(id: string): TerminalError {
  return terminalError(
    "not-found",
    `no terminal ${id}`,
    "check the id with list()",
  );
}

function notLive(id: string, hint: string): TerminalError {
  return terminalError("not-live", `terminal ${id} has finished`, hint);
}

/**
 * An in-memory model of the Terminals port. It has no processes and no clock:
 * a test drives its programs with emit, finish and setStatus. A positive wait
 * timeout waits until the target can finish, since the fake keeps no clock;
 * a real backend enforces the timeout.
 */
export class FakeTerminals implements Terminals {
  readonly #self: string | undefined;
  readonly #models = new Map<string, Model>();
  readonly #events: TerminalEvent[] = [];
  readonly #waiters: Waiter[] = [];
  #next = 1;

  /** The `self` option is what self() returns: the caller's own terminal, as HC_TERMINAL_ID would give it. */
  constructor(options: { self?: string } = {}) {
    this.#self = options.self;
  }

  self(): string | undefined {
    return this.#self;
  }

  async run(spec: RunSpec): Promise<Started | TerminalError> {
    const taken = [...this.#models.values()].some(
      (model) => model.state === "live" && model.name === spec.name,
    );
    if (spec.name !== undefined && taken) {
      return terminalError(
        "name-taken",
        `a live terminal is already named ${spec.name}`,
        "wait for it to finish, or pick another name",
      );
    }
    if (spec.parent !== undefined) {
      const parent = this.#models.get(spec.parent);
      if (parent === undefined) {
        return notFound(spec.parent);
      }
      if (parent.state !== "live") {
        return notLive(spec.parent, "start the child under a live parent");
      }
    }
    const id = `t${this.#next++}`;
    this.#models.set(id, {
      id,
      state: "live",
      cwd: spec.cwd,
      labels: { ...spec.labels },
      outliveParent: spec.outliveParent === true,
      output: "",
      sent: [],
      ...(spec.name === undefined ? {} : { name: spec.name }),
      ...(spec.parent === undefined ? {} : { parent: spec.parent }),
    });
    this.#events.push({ kind: "started", terminal: id });
    return { id };
  }

  async get(id: string): Promise<Terminal | TerminalError> {
    const model = this.#models.get(id);
    return model === undefined ? notFound(id) : viewOf(model);
  }

  async list(filter: ListFilter = {}): Promise<Terminal[] | TerminalError> {
    return [...this.#models.values()]
      .filter(
        (model) =>
          filter.childrenOf === undefined || model.parent === filter.childrenOf,
      )
      .filter((model) =>
        Object.entries(filter.labels ?? {}).every(
          ([key, value]) => model.labels[key] === value,
        ),
      )
      .map(viewOf);
  }

  async read(id: string, lines: number): Promise<Output | TerminalError> {
    const model = this.#models.get(id);
    if (model === undefined) {
      return notFound(id);
    }
    const rows =
      model.output === "" ? [] : model.output.replace(/\n$/, "").split("\n");
    return {
      text: rows.slice(Math.max(0, rows.length - lines)).join("\n"),
      complete: rows.length <= lines,
    };
  }

  async send(
    id: string,
    text: string,
    opts: SendOptions = {},
  ): Promise<Sent | TerminalError> {
    const model = this.#models.get(id);
    if (model === undefined) {
      return notFound(id);
    }
    if (model.state !== "live") {
      return notLive(id, "a finished terminal takes no input; start a new one");
    }
    if (opts.ifStatus !== undefined && model.status !== opts.ifStatus) {
      return terminalError(
        "status-mismatch",
        `terminal ${id} is ${model.status ?? "unreported"}, not ${opts.ifStatus}`,
        "wait until the terminal reports the status you named, then send",
      );
    }
    model.sent.push(text);
    return { id };
  }

  async wait(
    target: WaitTarget,
    timeoutMs: number,
  ): Promise<Waited | TerminalError> {
    const now = this.#settle(target);
    if (now !== undefined) {
      return now;
    }
    if (timeoutMs <= 0) {
      return terminalError(
        "timeout",
        `nothing has finished within ${timeoutMs} ms`,
        "wait longer, or check the terminal with get()",
      );
    }
    return await new Promise<Waited | TerminalError>((resolve) => {
      this.#waiters.push(() => {
        const settled = this.#settle(target);
        if (settled !== undefined) {
          resolve(settled);
        }
        return settled !== undefined;
      });
    });
  }

  async interrupt(id: string): Promise<Done | TerminalError> {
    return this.#liveError(id) ?? { id };
  }

  async kill(id: string): Promise<Done | TerminalError> {
    const error = this.#liveError(id);
    if (error === undefined) {
      this.#end(id, undefined);
    }
    return error ?? { id };
  }

  async remove(id: string): Promise<Done | TerminalError> {
    const model = this.#models.get(id);
    if (model === undefined) {
      return notFound(id);
    }
    if (model.state === "live") {
      return terminalError(
        "still-live",
        `terminal ${id} is still live`,
        "kill it first",
      );
    }
    this.#models.delete(id);
    this.#events.push({ kind: "removed", terminal: id });
    return { id };
  }

  async label(
    id: string,
    labels: Record<string, string>,
  ): Promise<Done | TerminalError> {
    const model = this.#models.get(id);
    if (model === undefined) {
      return notFound(id);
    }
    model.labels = { ...model.labels, ...labels };
    this.#events.push({ kind: "labelled", terminal: id });
    return { id };
  }

  /** Replays the events recorded so far, in order, then ends. */
  async *events(filter: EventFilter = {}): AsyncGenerator<TerminalEvent> {
    for (const event of this.#events.slice()) {
      if (filter.terminal === undefined || event.terminal === filter.terminal) {
        yield event;
      }
    }
  }

  /** Prints text to a terminal's output, as its program would. */
  emit(id: string, text: string): void {
    this.#existing(id).output += text;
  }

  /** Ends a terminal's program with an exit code, as the program exiting would. */
  finish(id: string, exitCode: number): void {
    this.#existing(id);
    this.#end(id, exitCode);
  }

  /** Sets the status a terminal reports. */
  setStatus(id: string, status: Status): void {
    this.#existing(id).status = status;
  }

  /** The texts sent to a terminal, in order. */
  sent(id: string): string[] {
    return [...this.#existing(id).sent];
  }

  #existing(id: string): Model {
    const model = this.#models.get(id);
    if (model === undefined) {
      throw new Error(`no terminal ${id}`);
    }
    return model;
  }

  /** The error for a terminal that is missing or finished, or undefined while it is live. */
  #liveError(id: string): TerminalError | undefined {
    const model = this.#models.get(id);
    if (model === undefined) {
      return notFound(id);
    }
    return model.state === "live"
      ? undefined
      : notLive(id, "a finished terminal takes no signals; start a new one");
  }

  /** Ends a terminal, then ends the children that do not outlive it, and wakes the waiters. */
  #end(id: string, exitCode: number | undefined): void {
    const model = this.#models.get(id);
    if (model === undefined || model.state !== "live") {
      return;
    }
    model.state = "finished";
    if (exitCode !== undefined) {
      model.exitCode = exitCode;
    }
    this.#events.push({ kind: "finished", terminal: id });
    for (const child of this.#models.values()) {
      if (child.parent === id && !child.outliveParent) {
        this.#end(child.id, undefined);
      }
    }
    const pending = this.#waiters.filter((waiter) => !waiter());
    this.#waiters.splice(0, this.#waiters.length, ...pending);
  }

  /** The result of a wait that can be answered now, or undefined while it must still wait. */
  #settle(target: WaitTarget): Waited | TerminalError | undefined {
    if ("terminal" in target) {
      const model = this.#models.get(target.terminal);
      if (model === undefined) {
        return notFound(target.terminal);
      }
      return model.state === "finished"
        ? { finished: [viewOf(model)] }
        : undefined;
    }
    if (!this.#models.has(target.of)) {
      return notFound(target.of);
    }
    const children = [...this.#models.values()].filter(
      (model) => model.parent === target.of,
    );
    if (target.children === "any" && children.length === 0) {
      return terminalError(
        "timeout",
        "no child can finish: it has none",
        "start a child first, or wait on a terminal",
      );
    }
    const finished = children.filter((model) => model.state === "finished");
    const done =
      target.children === "any"
        ? finished.length > 0
        : finished.length === children.length;
    return done ? { finished: finished.map(viewOf) } : undefined;
  }
}
