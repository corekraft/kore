import {
  terminalError,
  type Terminal,
  type TerminalError,
  type Status,
} from "./port.js";

// Support for FakeTerminals: the fake's own model and its pure view helpers.
// Not a unit: FakeTerminals.spec.ts exercises these through the fake.

/** A terminal as the fake models it: everything `get` reports, plus its output and input. */
export interface Model {
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

export function viewOf(model: Model): Terminal {
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

export function labelsMatch(
  labels: Record<string, string>,
  wanted: Record<string, string> = {},
): boolean {
  return Object.entries(wanted).every(([key, value]) => labels[key] === value);
}

export function notFound(id: string): TerminalError {
  return terminalError(
    "not-found",
    `no terminal ${id}`,
    "list terminals with hc ls --all",
  );
}
