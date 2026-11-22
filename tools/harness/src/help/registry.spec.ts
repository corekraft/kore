import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, CommandHelp } from "../runtime/index.js";
import { registryProblems } from "./registry.js";

// The per-command and per-guide checks have their own specs; this one tests the
// walk over the table: which commands are checked, and the lookup.
const fakes = vi.hoisted(() => ({
  commandProblems: vi.fn(),
  guideProblems: vi.fn(),
}));

vi.mock("./registry-command.js", () => ({
  commandProblems: fakes.commandProblems,
}));
vi.mock("./registry-guide.js", () => ({ guideProblems: fakes.guideProblems }));

const none = () => Promise.resolve(0);
const help: CommandHelp = {
  purpose: "p",
  when: "w",
  whenNot: "n",
  flags: {},
  examples: [{ command: "harness plan next", shows: "s" }],
  exits: [{ code: 0, meaning: "m" }],
  effects: { kind: "read-only", detail: "d" },
  seeAlso: [],
};

const next: Command = { summary: "set the Next: line", run: none, help };
const tick: Command = { summary: "tick one item", run: none, help };
const status: Command = { summary: "report the work", run: none, help };

const domains = { plan: { next, tick }, status: { "": status } };

beforeEach(() => {
  fakes.commandProblems.mockReturnValue([]);
  fakes.guideProblems.mockReturnValue([]);
});

describe("the registry walk", () => {
  it("passes a table where every command has help, and the guides pass", () => {
    expect(
      registryProblems({ domains, guides: {}, root: {} as never }),
    ).toEqual([]);
  });

  it("checks each command in full, with its help and the lookup; a domain's only command is named by the domain alone", () => {
    registryProblems({ domains, guides: {}, root: {} as never });
    expect(
      fakes.commandProblems.mock.calls.map(([path, command, record]) => [
        path,
        command,
        record,
      ]),
    ).toEqual([
      ["plan next", next, help],
      ["plan tick", tick, help],
      ["status", status, help],
    ]);
  });

  it("fails a command with no help, naming it, with no exemption list to join", () => {
    const bare = { summary: "tick one item", run: none } as unknown as Command;
    expect(
      registryProblems({
        domains: { plan: { tick: bare } },
        guides: {},
        root: {} as never,
      }),
    ).toEqual(["plan tick: has no help; write it beside the command"]);
    expect(fakes.commandProblems).not.toHaveBeenCalled();
  });

  it("fails a multi-line or empty summary for any command", () => {
    const multi = {
      plan: {
        next: { ...next, summary: "one\ntwo" },
        tick: { ...tick, summary: "" },
      },
      status: { "": status },
    };
    expect(
      registryProblems({ domains: multi, guides: {}, root: {} as never }),
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
      registryProblems({ domains, guides: {}, root: {} as never }),
    ).toEqual(["plan: domain has no guide in help/domain-guides.ts"]);
    expect(fakes.guideProblems).toHaveBeenCalledWith(
      { domains, guides: {}, root: {} },
      expect.any(Function),
    );
  });

  it("finds a command by its path, a domain-only command by the domain alone, and nothing else", () => {
    registryProblems({ domains, guides: {}, root: {} as never });
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
