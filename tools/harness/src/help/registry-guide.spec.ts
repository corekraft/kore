import { describe, expect, it } from "vitest";
import type { Command } from "../runtime/index.js";
import type { DomainGuide, RootGuide } from "./guide.js";
import type { Lookup } from "./registry-command.js";
import { guideProblems } from "./registry-guide.js";

const none = () => Promise.resolve(0);

const domains: Record<string, Record<string, Command>> = {
  plan: {
    active: { summary: "list", run: none },
    tick: { summary: "tick", run: none },
  },
  status: { "": { summary: "report", run: none } },
};

const lookup: Lookup = (path) => {
  const [domain = "", name = ""] = path.split(" ");
  return domains[domain]?.[name];
};

const plan: DomainGuide = {
  purpose: "Reads the plans.",
  flow: "List, then tick.",
  seeAlso: ["plan active"],
};
const status: DomainGuide = { purpose: "One report.", flow: "Run it." };

const root: RootGuide = {
  what: "The harness runs the delivery loop.",
  flows: [{ name: "spawn, wait, close", steps: ["plan active", "plan tick"] }],
  deeper: "Run harness <domain> --help.",
};

const guides = { plan, status };

describe("the domain and root guide checks", () => {
  it("passes a guide for every domain, one-line purposes and flows, and root flow steps that are commands", () => {
    expect(guideProblems({ domains, guides, root }, lookup)).toEqual([]);
  });

  it("fails a domain with no guide, naming the file to add it to", () => {
    expect(guideProblems({ domains, guides: { plan }, root }, lookup)).toEqual([
      "status: domain has no guide in help/domain-guides.ts",
    ]);
  });

  it("fails a guide for a domain the command table does not have", () => {
    expect(
      guideProblems(
        { domains, guides: { ...guides, ghost: status }, root },
        lookup,
      ),
    ).toEqual(['guide for "ghost": the command table has no such domain']);
  });

  it("fails a guide purpose that is empty or over more than one line", () => {
    expect(
      guideProblems(
        {
          domains,
          guides: {
            ...guides,
            plan: { ...plan, purpose: "Reads\nthe plans." },
          },
          root,
        },
        lookup,
      ),
    ).toEqual(["plan: guide purpose is empty or more than one line"]);
  });

  it("fails a guide flow that is empty", () => {
    expect(
      guideProblems(
        {
          domains,
          guides: { ...guides, status: { ...status, flow: "" } },
          root,
        },
        lookup,
      ),
    ).toEqual(["status: guide flow is empty or more than one line"]);
  });
});

describe("the guide checks, related commands and root", () => {
  it("fails a related command in a guide that resolves to nothing", () => {
    expect(
      guideProblems(
        {
          domains,
          guides: { ...guides, plan: { ...plan, seeAlso: ["plan nope"] } },
          root,
        },
        lookup,
      ),
    ).toEqual(['plan: guide see also "plan nope" is not a command']);
  });

  it("fails a root what or deeper that is empty or over more than one line", () => {
    expect(
      guideProblems({ domains, guides, root: { ...root, what: "" } }, lookup),
    ).toEqual(["root: what is empty or more than one line"]);
    expect(
      guideProblems(
        { domains, guides, root: { ...root, deeper: "a\nb" } },
        lookup,
      ),
    ).toEqual(["root: deeper is empty or more than one line"]);
  });

  it("fails a root flow step that is not a real command, naming the flow and the step", () => {
    const flows = [
      { name: "spawn, wait, close", steps: ["plan active", "session fly"] },
    ];
    expect(
      guideProblems({ domains, guides, root: { ...root, flows } }, lookup),
    ).toEqual([
      'root flow "spawn, wait, close" step "session fly" is not a command',
    ]);
  });

  it("fails a root flow with no steps", () => {
    const flows = [{ name: "empty", steps: [] }];
    expect(
      guideProblems({ domains, guides, root: { ...root, flows } }, lookup),
    ).toEqual(['root flow "empty" has no steps']);
  });
});
