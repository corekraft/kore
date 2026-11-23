import { stubHelp } from "../testing/index.js";
import { describe, expect, it } from "vitest";
import type { Command, CommandHelp } from "../runtime/index.js";
import type { DomainGuide, RootGuide } from "./guide.js";
import { commandView, domainView, rootView } from "./view.js";

const none = () => Promise.resolve(0);

const rootGuide: RootGuide = {
  what: "The harness runs the delivery loop.",
  flows: [
    {
      name: "spawn, wait, close",
      steps: ["session spawn", "session wait", "session close"],
    },
  ],
  deeper: "Run harness <domain> --help.",
};

const guides: Record<string, DomainGuide> = {
  plan: {
    purpose: "Reads and edits the plan files.",
    flow: "Read with plan active, then tick.",
    seeAlso: ["plan next"],
  },
  status: {
    purpose: "One read-only report.",
    flow: "Run it to see where the work stands.",
  },
};

describe("the root view", () => {
  it("lists each domain with its one-line purpose, in guide order, with the flows and how to go deeper", () => {
    expect(rootView(rootGuide, guides)).toEqual({
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
    });
  });
});

describe("the domain view", () => {
  it("lists each command by its full path and summary, and a domain's own command by the domain alone", () => {
    const commands: Record<string, Command> = {
      active: { help: stubHelp, summary: "list the active plans", run: none },
      tick: { help: stubHelp, summary: "tick one open item", run: none },
    };
    expect(domainView("plan", commands, guides.plan!)).toEqual({
      level: "domain",
      domain: "plan",
      purpose: "Reads and edits the plan files.",
      flow: "Read with plan active, then tick.",
      commands: [
        { path: "plan active", summary: "list the active plans" },
        { path: "plan tick", summary: "tick one open item" },
      ],
      seeAlso: ["plan next"],
    });
  });

  it("names a domain-only command by the domain alone, and gives no related commands when the guide has none", () => {
    const view = domainView(
      "status",
      { "": { help: stubHelp, summary: "report the work", run: none } },
      guides.status!,
    );
    expect(view.commands).toEqual([
      { path: "status", summary: "report the work" },
    ]);
    expect(view.seeAlso).toEqual([]);
  });
});

const next: Command = {
  help: stubHelp,
  summary: "set the Next: line",
  options: { plan: "string", text: "string", "dry-run": "boolean" },
  run: none,
};

const nextHelp: CommandHelp = {
  purpose: "Sets the one Next: line under the current step.",
  when: "When the next step of a plan changes.",
  whenNot: "When only reading the plan; use plan active.",
  flags: {
    plan: "The plan number; the default is the highest-numbered plan.",
    text: "The line to write.",
    "dry-run": "Reports the changes without writing them.",
  },
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

describe("the command view", () => {
  it("builds the usage line from the declared flags, in declaration order, with the kind of each", () => {
    expect(commandView("plan next", next, nextHelp)).toEqual({
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
          description:
            "The plan number; the default is the highest-numbered plan.",
        },
        { name: "text", kind: "string", description: "The line to write." },
        {
          name: "dry-run",
          kind: "boolean",
          description: "Reports the changes without writing them.",
        },
      ],
      examples: nextHelp.examples,
      exits: nextHelp.exits,
      effects: nextHelp.effects,
      seeAlso: ["plan active", "plan tick"],
    });
  });

  it("names a declared operand in the usage line and gives it its description, and has no operand otherwise", () => {
    const wait: Command = {
      help: stubHelp,
      summary: "wait for a session",
      options: { timeout: "string" },
      operand: "name",
      run: none,
    };
    const help: CommandHelp = {
      ...nextHelp,
      flags: { timeout: "Gives up after this many milliseconds." },
      operand: "The session's name.",
    };
    const view = commandView("session wait", wait, help);
    expect(view.usage).toBe("harness session wait <name> [--timeout <value>]");
    expect(view).toHaveProperty("operand", {
      name: "name",
      description: "The session's name.",
    });
    expect(commandView("plan next", next, nextHelp)).not.toHaveProperty(
      "operand",
    );
  });

  it("prints a domain-only command by the domain alone, in its usage line", () => {
    const status: Command = {
      help: stubHelp,
      summary: "report the work",
      run: none,
    };
    expect(commandView("status", status, nextHelp).usage).toBe(
      "harness status",
    );
  });
});

describe("the help record", () => {
  it("is required on every command: a command with none is a compile error", () => {
    // @ts-expect-error help is required on Command, so a command with no help record does not compile
    const bare: Command = { summary: "tick one open item", run: none };
    expect(bare.summary).toBe("tick one open item");
  });
});
