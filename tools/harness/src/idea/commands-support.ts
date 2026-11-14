// Fixtures and fakes the command unit specs share. Not a unit, so it has no spec
// of its own. vi.mock is per spec file, so each spec mocks the repository, the
// sync and the field validator itself; prepareCommands() wires those mocks to fakes.
import { vi } from "vitest";
import type { Command, CommandContext } from "../runtime/index.js";
import { ideaCommands } from "./commands.js";
import {
  asRepository,
  fakeDeps,
  fakeRepository,
  type FakeDeps,
  type FakeRepository,
} from "./idea-support.js";
import { IdeaError, scalar } from "./record.js";
import { IdeaRepository } from "./repository.js";

export const PATH = "docs/ideas/0001-cache-the-probe-results.md";
export const URL = "https://github.com/corekraft/kore/issues/300";

const required = (name: string): Command => {
  const command = ideaCommands[name];
  if (command === undefined) {
    throw new Error(`no idea command ${name}`);
  }
  return command;
};
export const create = required("new");
export const list = required("list");
export const show = required("show");
export const sync = required("sync");

export const context = (
  deps: FakeDeps,
  options: Record<string, string | boolean> = {},
  json = false,
): CommandContext => ({ json, options, deps });

export const FIELDS = {
  title: "Cache the probe results!",
  hypothesis: "Caching probes cuts up time.",
  "expected-outcome": "Up time drops by 20 percent.",
  measurement: "Compare kore local up duration in the ledger.",
  "safety-pattern": "feature-flagged",
};

/** Fresh fakes for one test, with the repository and the validator wired to them. */
export function prepareCommands(): { deps: FakeDeps; repo: FakeRepository } {
  const deps = fakeDeps();
  const repo = fakeRepository();
  vi.mocked(IdeaRepository).mockImplementation(function () {
    return asRepository(repo);
  });
  vi.mocked(scalar).mockImplementation((flag, value) => {
    if (value === undefined || value.trim() === "") {
      throw new IdeaError(`Missing --${flag}; pass a non-empty value.`);
    }
    return value;
  });
  return { deps, repo };
}
