import { type Model, labelsMatch, notFound, viewOf } from "./fake-support.js";
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

interface Waiter {
  /** Returns true once it has resolved its wait, so the fake drops it. */
  check(): boolean;
}

export interface FakeOptions {
  /** What self() returns: the caller's own terminal, as HC_TERMINAL_ID would give it. */
  self?: string;
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

  constructor(options: FakeOptions = {}) {
    this.#self = options.self;
  }

  self(): string | undefined {
    return this.#self;
  }

  async run(spec: RunSpec): Promise<Started | TerminalError> {
    if (spec.name !== undefined && this.#liveNamed(spec.name)) {
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
        return terminalError(
          "not-live",
          `terminal ${spec.parent} has finished`,
        );
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
      .filter((model) => labelsMatch(model.labels, filter.labels))
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
      return terminalError("not-live", `terminal ${id} has finished`);
    }
    if (opts.ifStatus !== undefined && model.status !== opts.ifStatus) {
      return terminalError(
        "status-mismatch",
        `terminal ${id} is ${model.status ?? "unreported"}, not ${opts.ifStatus}`,
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
    const waitable = this.#waitable(target);
    if (
      timeoutMs <= 0 ||
      (waitable !== undefined && waitable.any && waitable.watched.length === 0)
    ) {
      return terminalError(
        "timeout",
        `nothing has finished within ${timeoutMs} ms`,
        "wait longer, or check with hc get",
      );
    }
    return await new Promise<Waited | TerminalError>((resolve) => {
      this.#waiters.push({
        check: () => {
          const settled = this.#settle(target);
          if (settled === undefined) {
            return false;
          }
          resolve(settled);
          return true;
        },
      });
    });
  }

  async interrupt(id: string): Promise<Done | TerminalError> {
    return this.#changeLive(id, () => undefined);
  }

  async kill(id: string): Promise<Done | TerminalError> {
    return this.#changeLive(id, () => this.#end(id, undefined));
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

  events(filter: EventFilter = {}): AsyncIterable<TerminalEvent> {
    const recorded = this.#events.slice();
    return (async function* replay(): AsyncGenerator<TerminalEvent> {
      for (const event of recorded) {
        if (
          filter.terminal === undefined ||
          event.terminal === filter.terminal
        ) {
          yield event;
        }
      }
    })();
  }

  /** Prints text to a terminal's output, as its program would. */
  emit(id: string, text: string): void {
    this.#require(id).output += text;
  }

  /** Ends a terminal's program with an exit code, as the program exiting would. */
  finish(id: string, exitCode: number): void {
    this.#require(id);
    this.#end(id, exitCode);
  }

  /** Sets the status a terminal reports. */
  setStatus(id: string, status: Status): void {
    this.#require(id).status = status;
  }

  /** The texts sent to a terminal, in order. */
  sent(id: string): string[] {
    return [...this.#require(id).sent];
  }

  #require(id: string): Model {
    const model = this.#models.get(id);
    if (model === undefined) {
      throw new Error(`no terminal ${id}`);
    }
    return model;
  }

  #liveNamed(name: string): boolean {
    return [...this.#models.values()].some(
      (model) => model.state === "live" && model.name === name,
    );
  }

  #changeLive(id: string, change: () => void): Done | TerminalError {
    const model = this.#models.get(id);
    if (model === undefined) {
      return notFound(id);
    }
    if (model.state !== "live") {
      return terminalError("not-live", `terminal ${id} has finished`);
    }
    change();
    return { id };
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
    this.#wake();
  }

  #wake(): void {
    const pending = this.#waiters.filter((waiter) => !waiter.check());
    this.#waiters.splice(0, this.#waiters.length, ...pending);
  }

  #waitable(
    target: WaitTarget,
  ): { watched: Model[]; any: boolean } | undefined {
    if ("terminal" in target) {
      const model = this.#models.get(target.terminal);
      return model === undefined ? undefined : { watched: [model], any: true };
    }
    if (!this.#models.has(target.of)) {
      return undefined;
    }
    const watched = [...this.#models.values()].filter(
      (model) => model.parent === target.of,
    );
    return { watched, any: target.children === "any" };
  }

  /** The result of a wait that can be answered now, or undefined while it must still wait. */
  #settle(target: WaitTarget): Waited | TerminalError | undefined {
    const waitable = this.#waitable(target);
    if (waitable === undefined) {
      return "terminal" in target
        ? notFound(target.terminal)
        : notFound(target.of);
    }
    const finished = waitable.watched.filter(
      (model) => model.state === "finished",
    );
    const done = waitable.any
      ? finished.length > 0
      : finished.length === waitable.watched.length;
    return done ? { finished: finished.map(viewOf) } : undefined;
  }
}
