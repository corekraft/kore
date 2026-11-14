// Fixtures only the infra command unit spec uses. A support file is not a unit,
// so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { ActionHandler, CommandContext } from "./context.js";
import { mutateAction } from "./context.js";
import { boolFlag, stringFlag } from "./flags.js";
import { fakeContext, parsedArgs } from "./cli-support.js";

/** The action table the last mutation was given. */
export function actionsOf(): Record<string, ActionHandler> {
  return vi.mocked(mutateAction).mock.calls.at(-1)![1];
}

/** Flags by name: strings for valued flags, true for standalone ones. */
export function flags(values: Record<string, string | boolean>): void {
  vi.mocked(stringFlag).mockImplementation((_parsed, name) =>
    typeof values[name] === "string" ? values[name] : undefined,
  );
  vi.mocked(boolFlag).mockImplementation(
    (_parsed, name) => values[name] === true,
  );
}

/** A context for `kore app <action> reference`. */
export function appContext(action: string, json = false): CommandContext {
  return fakeContext({
    command: "app",
    action,
    json,
    parsed: parsedArgs({}, ["reference"]),
  });
}

/** Platform status rows, and the exit code the rows give (ADR 0067). */
export const platformStatusCases: [
  string,
  { name: string; status: string }[],
  number,
][] = [
  [
    "platform status exits 1 while a prerequisite is degraded",
    [{ name: "gateway", status: "degraded" }],
    1,
  ],
  [
    "platform status exits 0 when only the audit-only checks are unready",
    [
      { name: "crd-ownership", status: "degraded" },
      { name: "backups", status: "degraded" },
    ],
    0,
  ],
  [
    "platform status counts a gated-off component as not blocking the gate",
    [
      { name: "gateway", status: "gated-off" },
      { name: "registry", status: "ready" },
    ],
    0,
  ],
];

/** Platform render: the flags, the output directory, the printed report and --json. */
export const renderCases: [
  string,
  Record<string, string | boolean>,
  string | undefined,
  { status: string; output: string },
  boolean,
][] = [
  [
    "platform render writes nothing and reports the output as discarded when no --output is given",
    {},
    undefined,
    { status: "valid", output: "stdout discarded" },
    true,
  ],
  [
    "platform render writes to the --output directory and reports it",
    { output: "rendered" },
    "rendered",
    { status: "valid", output: "rendered" },
    false,
  ],
];

/** Data restore: the flags it is given and the options it passes on. */
export const restoreCases: [
  string,
  Record<string, string | boolean>,
  Record<string, unknown>,
][] = [
  [
    "passes its artifact, identity and both opt-ins to the restore",
    {
      from: "dump.age",
      identity: "key.txt",
      "overwrite-data": true,
      yes: true,
    },
    { from: "dump.age", identity: "key.txt", overwriteData: true, yes: true },
  ],
  [
    "leaves the identity key out of the restore when --identity is not given",
    { from: "dump.age" },
    { from: "dump.age", overwriteData: false, yes: false },
  ],
];
