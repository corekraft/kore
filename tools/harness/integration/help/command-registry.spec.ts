import { describe, expect, it } from "vitest";
import { domains } from "../../src/cli/index.js";
import {
  domainGuides,
  registryProblems,
  rootGuide,
  type RegistryInput,
} from "../../src/help/index.js";
import type { Command } from "../../src/runtime/index.js";

// The registry specs read the real command table. They run in the integration
// tier because importing every domain costs more than a unit test's budget.
const real: RegistryInput = {
  domains,
  guides: domainGuides,
  root: rootGuide,
};

// A command with no help record cannot compile, so these cast one past the type to show
// the registry also reports it at run time.
const bareCommand = (summary: string): Command =>
  ({ summary, run: () => Promise.resolve(0) }) as unknown as Command;

describe("the command registry over the real command table", () => {
  it("passes every check: each command has help and passes its checks, each domain has a guide, each root flow step is a command", () => {
    expect(registryProblems(real)).toEqual([]);
  });

  it("fails a command added after the rollout that carries no help", () => {
    const added = {
      ...domains,
      plan: { ...domains.plan, scratch: bareCommand("a new command") },
    };
    expect(registryProblems({ ...real, domains: added })).toEqual([
      "plan scratch: has no help; write it beside the command",
    ]);
  });

  it("fails a domain added with no guide", () => {
    const added = {
      ...domains,
      scratch: { run: bareCommand("x") },
    };
    expect(registryProblems({ ...real, domains: added })).toEqual([
      "scratch run: has no help; write it beside the command",
      "scratch: domain has no guide in help/domain-guides.ts",
    ]);
  });

  it("fails a root flow step that names no real command", () => {
    const root = {
      ...rootGuide,
      flows: [
        { name: "spawn, wait, close", steps: ["session spawn", "session fly"] },
      ],
    };
    expect(registryProblems({ ...real, root })).toEqual([
      'root flow "spawn, wait, close" step "session fly" is not a command',
    ]);
  });
});

// The nine commands whose summaries this change shortens: one line each, the detail in help.
const shortened: [domain: string, name: string][] = [
  ["guardrail", "status"],
  ["guardrail", "deny"],
  ["guardrail", "request"],
  ["guardrail", "activate"],
  ["guardrail", "replay"],
  ["ruleset", "sync"],
  ["ruleset", "insights"],
  ["flag", "activate"],
  ["flag", "audit"],
];

describe("the summaries of the guardrail, ruleset and flag commands", () => {
  it("are one line of at most 100 characters each, with the detail in each command's help", () => {
    const table: Record<string, Record<string, Command>> = domains;
    const longer = shortened.flatMap(([domain, name]) => {
      const summary = table[domain]?.[name]?.summary ?? "";
      return summary.length > 100
        ? [
            `${domain} ${name}: summary is ${summary.length} characters, over 100`,
          ]
        : [];
    });
    expect(longer).toEqual([]);
  });
});
