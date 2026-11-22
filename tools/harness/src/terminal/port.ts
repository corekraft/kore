// The Terminals port, in hc's words (plan 16, Design). The port copies hc's
// concepts, not its CLI flags, and a backend supplies these concepts without
// shaping them. There is no layout, no split and no machine field: Terminal.id
// is opaque and may carry a machine prefix.

/** A reported status. Only a report makes "done"; see plan 16, Grilled Decisions 1. */
export type Status = "idle" | "working" | "done" | "blocked" | "error";

export interface Terminal {
  id: string;
  name?: string;
  parent?: string;
  state: "live" | "finished";
  status?: Status;
  /** hc's turn counter: it advances with each delivery to the terminal. Absent from a reply that does not name it. */
  turn?: number;
  exitCode?: number;
  labels: Record<string, string>;
  cwd: string;
}

export type TerminalErrorKind =
  | "not-found"
  | "not-live"
  | "still-live"
  | "name-taken"
  | "status-mismatch"
  | "timeout"
  | "invalid-spec"
  | "unavailable";

/** The structured error every port method returns in place of a result. */
export interface TerminalError {
  error: { kind: TerminalErrorKind; message: string; hint?: string };
}

export interface RunSpec {
  argv: readonly string[];
  name?: string;
  cwd: string;
  labels?: Record<string, string>;
  env?: Record<string, string>;
  /** hc run --parent: the child ends with its parent unless outliveParent is set. */
  parent?: string;
  outliveParent?: boolean;
  /** false passes hc run --no-notify: the parent gets no note when this child exits (plan 16, Step 4). */
  notify?: boolean;
}

export interface Started {
  id: string;
}

export interface Done {
  id: string;
}

export interface Sent {
  id: string;
}

/** The screen and the history above it, as hc reads them: at least the last lines asked for. */
export interface Output {
  text: string;
}

export interface SendOptions {
  ifStatus?: "idle" | "working";
}

/** A terminal by id, or the children of `of` (any one of them, or all of them). */
export type WaitTarget =
  { terminal: string } | { children: "any" | "all"; of: string };

export interface Waited {
  finished: Terminal[];
}

export interface ListFilter {
  labels?: Record<string, string>;
  childrenOf?: string;
}

export interface EventFilter {
  terminal?: string;
  /** Only events for terminals carrying all of these labels. */
  labels?: Record<string, string>;
}

export interface TerminalEvent {
  /** "changed" is any change that is not a finish: a foreground change, a status, a turn. */
  kind: "started" | "labelled" | "changed" | "finished" | "removed";
  terminal: string;
}

export interface Terminals {
  /** HC_TERMINAL_ID, or undefined when the caller is not a terminal. */
  self(): string | undefined;
  run(spec: RunSpec): Promise<Started | TerminalError>;
  get(id: string): Promise<Terminal | TerminalError>;
  list(filter?: ListFilter): Promise<Terminal[] | TerminalError>;
  read(id: string, lines: number): Promise<Output | TerminalError>;
  send(
    id: string,
    text: string,
    opts?: SendOptions,
  ): Promise<Sent | TerminalError>;
  /** A timeout of 0 checks once and never waits. */
  wait(target: WaitTarget, timeoutMs: number): Promise<Waited | TerminalError>;
  interrupt(id: string): Promise<Done | TerminalError>;
  kill(id: string): Promise<Done | TerminalError>;
  remove(id: string): Promise<Done | TerminalError>;
  label(
    id: string,
    labels: Record<string, string>,
  ): Promise<Done | TerminalError>;
  events(filter?: EventFilter): AsyncIterable<TerminalEvent>;
}

/** The structured error a port method returns in place of a result. */
export function terminalError(
  kind: TerminalErrorKind,
  message: string,
  hint?: string,
): TerminalError {
  return {
    error: hint === undefined ? { kind, message } : { kind, message, hint },
  };
}
