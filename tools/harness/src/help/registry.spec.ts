import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../runtime/index.js";
import { registryProblems } from "./registry.js";

// The per-command and per-guide checks have their own specs; this one tests the
// walk over the table: which commands are checked, which are exempt, and the lookup.
const fakes = vi.hoisted(() => ({
  commandProblems: vi.fn(),
  guideProblems: vi.fn(),
}));

vi.mock("./registry-command.js", () => ({
  commandProblems: fakes.commandProblems,
}));
vi.mock("./registry-guide.js", () => ({ guideProblems: fakes.guideProblems }));

const none = () => Promise.resolve(0);
const help = {
  purpose: "p",
  when: "w",
  whenNot: "n",
  flags: {},
  examples: [{ command: "harness plan next", shows: "s" }],
  exits: [{ code: 0, meaning: "m" }],
  effects: { kind: "read-only" as const, detail: "d" },
  seeAlso: [],
};

const next: Command = { summary: "set the Next: line", run: none, help };
const tick: Command = { summary: "tick one item", run: none };
const status: Command = { summary: "report the work", run: none };

const domains = { plan: { next, tick }, status: { "": status } };

beforeEach(() => {
  fakes.commandProblems.mockReturnValue([]);
  fakes.guideProblems.mockReturnValue([]);
});

describe("the registry walk", () => {
  it("passes a table where every command has help or is exempt, and the guides pass", () => {
    expect(
      registryProblems({
        domains,
        guides: {},
        root: {} as never,
        undocumented: ["plan tick", "status"],
      }),
    ).toEqual([]);
  });

  it("checks a command that has help, and not exempt, in full, with its help and the lookup", () => {
    registryProblems({
      domains,
      guides: {},
      root: {} as never,
      undocumented: ["plan tick", "status"],
    });
    expect(fakes.commandProblems).toHaveBeenCalledTimes(1);
    expect(fakes.commandProblems).toHaveBeenCalledWith(
      "plan next",
      next,
      help,
      expect.any(Function),
    );
  });
});

describe("the registry walk, exemptions and summaries", () => {
  it("fails a command with no help that is not exempt, naming it and the list it must join", () => {
    expect(
      registryProblems({
        domains,
        guides: {},
        root: {} as never,
        undocumented: ["status"],
      }),
    ).toEqual([
      "plan tick: has no help; write it beside the command or list it in help/exemptions.ts",
    ]);
  });

  it("leaves a command with no help alone when it is on the exemption list", () => {
    expect(
      registryProblems({
        domains,
        guides: {},
        root: {} as never,
        undocumented: ["plan tick", "status"],
      }),
    ).toEqual([]);
    expect(fakes.commandProblems).toHaveBeenCalledTimes(1);
  });

  it("fails a command that has help but is still on the exemption list, until its line is taken off", () => {
    expect(
      registryProblems({
        domains,
        guides: {},
        root: {} as never,
        undocumented: ["plan next", "plan tick", "status"],
      }),
    ).toEqual([
      "plan next: has help but is still on the exemption list; remove its line",
    ]);
  });

  it("fails an exemption that names no command in the table", () => {
    expect(
      registryProblems({
        domains,
        guides: {},
        root: {} as never,
        undocumented: ["plan tick", "status", "plan nope"],
      }),
    ).toEqual(['exemption "plan nope" is not a command in the table']);
  });
});

describe("the registry walk, guides and lookup", () => {
  it("fails a multi-line or empty summary for any command, exempt or not", () => {
    const multi = {
      plan: {
        next: { ...next, summary: "one\ntwo" },
        tick: { ...tick, summary: "" },
      },
      status: { "": status },
    };
    expect(
      registryProblems({
        domains: multi,
        guides: {},
        root: {} as never,
        undocumented: ["plan tick", "status"],
      }),
    ).toEqual([
      "plan next: summary is empty or more than one line",
      "plan tick: summary is empty or more than one line",
    ]);
  });

  it("adds the guide and root problems to the command problems", () => {
    fakes.guideProblems.mockReturnValue([
      "plan: domain has no guide in help/domain-guides.ts",
    ]);
    expect(
      registryProblems({
        domains,
        guides: {},
        root: {} as never,
        undocumented: ["plan tick", "status"],
      }),
    ).toEqual(["plan: domain has no guide in help/domain-guides.ts"]);
    expect(fakes.guideProblems).toHaveBeenCalledWith(
      { domains, guides: {}, root: {} },
      expect.any(Function),
    );
  });

  it("finds a command by its path, a domain-only command by the domain alone, and nothing else", () => {
    registryProblems({
      domains,
      guides: {},
      root: {} as never,
      undocumented: ["plan tick", "status"],
    });
    const lookup = fakes.commandProblems.mock.calls[0]?.[3] as (
      p: string,
    ) => Command | undefined;
    expect(lookup("plan next")).toBe(next);
    expect(lookup("status")).toBe(status);
    expect(lookup("plan")).toBeUndefined();
    expect(lookup("plan nope")).toBeUndefined();
    expect(lookup("constructor")).toBeUndefined();
  });
});
