import { describe, expect, it } from "vitest";
import { domains } from "../../src/cli/index.js";
import {
  domainGuides,
  registryProblems,
  rootGuide,
  undocumented,
  type RegistryInput,
} from "../../src/help/index.js";

// The registry specs read the real command table. They run in the integration
// tier because importing every domain costs more than a unit test's budget.
const real: RegistryInput = {
  domains,
  guides: domainGuides,
  root: rootGuide,
  undocumented,
};

describe("the command registry over the real command table", () => {
  it("passes every check: each command is documented or exempt, each domain has a guide, each root flow step is a command", () => {
    expect(registryProblems(real)).toEqual([]);
  });

  it("fails a command added after the rollout that carries no help and is not on the exemption list", () => {
    const added = {
      ...domains,
      plan: {
        ...domains.plan,
        scratch: { summary: "a new command", run: () => Promise.resolve(0) },
      },
    };
    expect(registryProblems({ ...real, domains: added })).toEqual([
      "plan scratch: has no help; write it beside the command or list it in help/exemptions.ts",
    ]);
  });

  it("fails a domain added with no guide", () => {
    const added = {
      ...domains,
      scratch: { run: { summary: "x", run: () => Promise.resolve(0) } },
    };
    expect(registryProblems({ ...real, domains: added })).toEqual([
      "scratch run: has no help; write it beside the command or list it in help/exemptions.ts",
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
