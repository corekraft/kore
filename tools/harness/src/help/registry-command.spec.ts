import { stubHelp } from "../testing/index.js";
import { describe, expect, it } from "vitest";
import type { Command, CommandEffects, CommandHelp } from "../runtime/index.js";
import { commandProblems, type Lookup } from "./registry-command.js";

const none = () => Promise.resolve(0);

const next: Command = {
  help: stubHelp,
  summary: "set the Next: line",
  options: { plan: "string", "dry-run": "boolean" },
  run: none,
};

const active: Command = {
  help: stubHelp,
  summary: "list the active plans",
  run: none,
};
const status: Command = {
  help: stubHelp,
  summary: "report the work",
  run: none,
};

const commands = new Map<string, Command>([
  ["plan next", next],
  ["plan active", active],
  ["status", status],
]);
const lookup: Lookup = (path) => commands.get(path);

function helpWith(changes: Partial<CommandHelp> = {}): CommandHelp {
  return {
    purpose: "Sets the one Next: line.",
    when: "When the next step changes.",
    whenNot: "When only reading; use plan active.",
    flags: { plan: "The plan number.", "dry-run": "Reports without writing." },
    examples: [
      { command: "harness plan next --plan 3", shows: "the Next: line it set" },
    ],
    exits: [{ code: 0, meaning: "set" }],
    effects: { kind: "mutates", detail: "rewrites one plan" },
    seeAlso: ["plan active"],
    ...changes,
  };
}

describe("the command help checks", () => {
  it("passes a complete help record: every flag described, an example, exits, effects and related commands that resolve", () => {
    expect(commandProblems("plan next", next, helpWith(), lookup)).toEqual([]);
  });

  it("passes a domain-only command whose example names it by the domain alone", () => {
    const help = helpWith({
      examples: [{ command: "harness status --json", shows: "the report" }],
      flags: {},
      seeAlso: [],
    });
    expect(commandProblems("status", status, help, lookup)).toEqual([]);
  });
});

describe("the command help checks, failures", () => {
  it("fails an empty purpose, when or when-not, naming the field", () => {
    expect(
      commandProblems("plan next", next, helpWith({ when: " " }), lookup),
    ).toEqual(["plan next: help has an empty when"]);
  });
});

describe("the command help checks, flags and examples", () => {
  it("fails a declared flag that has no description", () => {
    expect(
      commandProblems(
        "plan next",
        next,
        helpWith({ flags: { "dry-run": "Reports." } }),
        lookup,
      ),
    ).toEqual(['plan next: declared flag "--plan" has no description']);
  });

  it("fails a description for a flag the command does not declare", () => {
    const help = helpWith({
      flags: { plan: "The plan.", "dry-run": "Reports.", ghost: "Nothing." },
    });
    expect(commandProblems("plan next", next, help, lookup)).toEqual([
      'plan next: help describes "--ghost", which the command does not declare',
    ]);
  });

  it("fails a flag description over more than one line", () => {
    const help = helpWith({
      flags: { plan: "The plan\nnumber.", "dry-run": "Reports." },
    });
    expect(commandProblems("plan next", next, help, lookup)).toEqual([
      'plan next: description of "--plan" is more than one line',
    ]);
  });

  it("fails a declared operand with no description", () => {
    const withOperand: Command = { ...next, operand: "name" };
    expect(
      commandProblems("plan next", withOperand, helpWith(), lookup),
    ).toEqual([
      'plan next: declares operand "name" but help has no description for it',
    ]);
  });

  it("fails an operand description for a command that declares no operand", () => {
    expect(
      commandProblems(
        "plan next",
        next,
        helpWith({ operand: "The name." }),
        lookup,
      ),
    ).toEqual([
      "plan next: help describes an operand, which the command does not declare",
    ]);
  });
});

describe("the command help checks, examples and exits", () => {
  it("fails a command with no example", () => {
    expect(
      commandProblems("plan next", next, helpWith({ examples: [] }), lookup),
    ).toEqual(["plan next: has no example"]);
  });

  it("fails an example that does not start with harness", () => {
    const help = helpWith({
      examples: [{ command: "plan next --plan 3", shows: "x" }],
    });
    expect(commandProblems("plan next", next, help, lookup)).toEqual([
      'plan next: example "plan next --plan 3" does not start with "harness"',
    ]);
  });

  it("fails an example that names an unknown command", () => {
    const help = helpWith({
      examples: [{ command: "harness plan nope", shows: "x" }],
    });
    expect(commandProblems("plan next", next, help, lookup)).toEqual([
      'plan next: example "harness plan nope" names an unknown command',
    ]);
  });

  it("fails an example that names a flag its target command does not declare, even one the owner declares", () => {
    const help = helpWith({
      examples: [{ command: "harness plan active --plan 3", shows: "x" }],
    });
    expect(commandProblems("plan next", next, help, lookup)).toEqual([
      'plan next: example "harness plan active --plan 3" names undeclared flag "--plan"',
    ]);
  });

  it("accepts the global --json and --help flags in an example", () => {
    const help = helpWith({
      examples: [{ command: "harness plan next --plan 3 --json", shows: "x" }],
    });
    expect(commandProblems("plan next", next, help, lookup)).toEqual([]);
  });

  it("fails an example with no shows line", () => {
    const help = helpWith({
      examples: [{ command: "harness plan next", shows: " " }],
    });
    expect(commandProblems("plan next", next, help, lookup)).toEqual([
      'plan next: example "harness plan next" has no "shows" line',
    ]);
  });

  it("fails a related command that resolves to nothing", () => {
    expect(
      commandProblems(
        "plan next",
        next,
        helpWith({ seeAlso: ["plan nope"] }),
        lookup,
      ),
    ).toEqual(['plan next: see also "plan nope" is not a command']);
  });

  it("fails a command with no exit codes", () => {
    expect(
      commandProblems("plan next", next, helpWith({ exits: [] }), lookup),
    ).toEqual(["plan next: has no exit codes"]);
  });
});

describe("the command help checks, exits and effects", () => {
  it("fails an exit code listed twice", () => {
    const exits = [
      { code: 0, meaning: "set" },
      { code: 0, meaning: "set again" },
    ];
    expect(
      commandProblems("plan next", next, helpWith({ exits }), lookup),
    ).toEqual(["plan next: lists exit code 0 twice"]);
  });

  it("fails an exit code with no meaning", () => {
    expect(
      commandProblems(
        "plan next",
        next,
        helpWith({ exits: [{ code: 0, meaning: "" }] }),
        lookup,
      ),
    ).toEqual(["plan next: exit code 0 has no meaning"]);
  });

  it("fails effects with no detail line", () => {
    expect(
      commandProblems(
        "plan next",
        next,
        helpWith({ effects: { kind: "read-only", detail: "" } }),
        lookup,
      ),
    ).toEqual(["plan next: effects has no detail"]);
  });

  it("fails effects that are neither read-only nor mutates", () => {
    const effects = {
      kind: "writes",
      detail: "x",
    } as unknown as CommandEffects;
    expect(
      commandProblems("plan next", next, helpWith({ effects }), lookup),
    ).toEqual(["plan next: effects kind is neither read-only nor mutates"]);
  });
});
