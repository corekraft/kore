import { describe, expect, it } from "vitest";
import type { CommandView, DomainView, HelpView, RootView } from "./view.js";
import { renderText } from "./render-text.js";

const root: RootView = {
  level: "root",
  what: "The harness runs the delivery loop.",
  domains: [
    { name: "plan", purpose: "Reads and edits the plan files." },
    { name: "status", purpose: "One read-only report." },
  ],
  flows: [
    {
      name: "spawn, wait, close",
      steps: ["session spawn", "session wait", "session close"],
    },
  ],
  deeper: "Run harness <domain> --help.",
};

const domain: DomainView = {
  level: "domain",
  domain: "plan",
  purpose: "Reads and edits the plan files.",
  flow: "Read with plan active, then tick.",
  commands: [
    { path: "plan active", summary: "list the active plans" },
    { path: "plan tick", summary: "tick one open item" },
  ],
  seeAlso: ["plan next"],
};

const command: CommandView = {
  level: "command",
  path: "plan next",
  summary: "set the Next: line",
  purpose: "Sets the one Next: line under the current step.",
  when: "When the next step of a plan changes.",
  whenNot: "When only reading the plan; use plan active.",
  usage: "harness plan next [--plan <value>] [--text <value>] [--dry-run]",
  flags: [
    {
      name: "plan",
      kind: "string",
      description: "The plan number; the default is the highest-numbered plan.",
    },
    { name: "text", kind: "string", description: "The line to write." },
    {
      name: "dry-run",
      kind: "boolean",
      description: "Reports the changes without writing them.",
    },
  ],
  examples: [
    {
      command: 'harness plan next --text "Step 2"',
      shows: "the one Next: line and every line it changed",
    },
  ],
  exits: [
    { code: 0, meaning: "the Next: line is set" },
    { code: 1, meaning: "no plan matched" },
  ],
  effects: {
    kind: "mutates",
    detail: "rewrites the Next: line of one plan file",
  },
  seeAlso: ["plan active", "plan tick"],
};

describe("the prose help at the root level", () => {
  it("prints what the harness is, each domain in one line, the flows as real commands, and how to go deeper", () => {
    expect(renderText(root)).toBe(`The harness runs the delivery loop.

Domains:
  plan    Reads and edits the plan files.
  status  One read-only report.

Common flows:
  spawn, wait, close:
    harness session spawn
    harness session wait
    harness session close

Going deeper:
  Run harness <domain> --help.
`);
  });
});

describe("the prose help at the domain level", () => {
  it("prints the purpose, the usual flow, each command with its summary, and related commands", () => {
    expect(renderText(domain)).toBe(`Reads and edits the plan files.

Usual flow:
  Read with plan active, then tick.

Commands:
  harness plan active  list the active plans
  harness plan tick    tick one open item

See also:
  harness plan next
`);
  });
});

describe("the prose help at the command level", () => {
  it("prints the usage, purpose, when to use and not, flags, examples, exit codes, effects and related commands under fixed headings", () => {
    expect(renderText(command)).toBe(`harness plan next: set the Next: line

Sets the one Next: line under the current step.

Usage:
  harness plan next [--plan <value>] [--text <value>] [--dry-run]

When to use:
  When the next step of a plan changes.

When not to use:
  When only reading the plan; use plan active.

Flags:
  --plan <value>  The plan number; the default is the highest-numbered plan.
  --text <value>  The line to write.
  --dry-run       Reports the changes without writing them.

Examples:
  harness plan next --text "Step 2"
    the one Next: line and every line it changed

Exit codes:
  0  the Next: line is set
  1  no plan matched

Effects:
  mutates: rewrites the Next: line of one plan file

See also:
  harness plan active
  harness plan tick
`);
  });

  it("names a declared operand in its own section, with its description", () => {
    const withOperand: CommandView = {
      ...command,
      usage: "harness session wait <name>",
      operand: { name: "name", description: "The session's name." },
    };
    expect(renderText(withOperand)).toContain(
      "Operand:\n  <name>  The session's name.\n",
    );
  });

  it("leaves out a section with nothing in it, such as flags for a command with none", () => {
    const bare: CommandView = { ...command, flags: [], seeAlso: [] };
    const text = renderText(bare);
    expect(text).not.toContain("Flags:");
    expect(text).not.toContain("See also:");
  });
});

describe("the prose renderer over every level", () => {
  it("ends every level's help with exactly one newline", () => {
    const views: HelpView[] = [root, domain, command];
    for (const view of views) {
      expect(renderText(view).endsWith("\n")).toBe(true);
      expect(renderText(view).endsWith("\n\n")).toBe(false);
    }
  });
});
