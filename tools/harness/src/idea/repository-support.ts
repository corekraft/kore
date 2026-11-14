// Fixtures and fakes the repository unit specs share. Not a unit, so it has no
// spec of its own. The record helpers are mocked by each spec (vi.mock is per
// file); defaultMocks() sets the behaviour those mocks answer with.
import { vi } from "vitest";
import {
  fakeClock,
  fakeFileSystem,
  recordFixture,
  type FakeFileSystem,
} from "./idea-support.js";
import { parseIdea, renderIdea } from "./record.js";
import { IdeaRepository } from "./repository.js";

export const ROOT = "/repo";
export const INDEX_PATH = `${ROOT}/docs/index.md`;
export const DIR = `${ROOT}/docs/ideas`;
export const NEW_PATH = "docs/ideas/0004-probe.md";

export const INDEX =
  "# Index\n\n## Decisions\n\n- x\n\n## Operations and Guides\n\n- y\n";

export const IDEA = {
  title: "Probe",
  summary: "Cache the probe results",
  hypothesis: "Caching probes cuts up time.",
  expectedOutcome: "Up time drops by 20 percent.",
  measurement: "Compare kore local up duration in the ledger.",
  safetyPattern: "feature-flagged",
};

export const eexist = () =>
  Object.assign(new Error("exists"), { code: "EEXIST" });

export function setup() {
  const fs: FakeFileSystem = fakeFileSystem();
  const clock = fakeClock();
  const repo = new IdeaRepository(fs, clock, ROOT);
  fs.exists.mockResolvedValue(true);
  return { fs, clock, repo };
}

/** parseIdea reads back a record for the path it was given; renderIdea renders a fixed file. */
export function defaultMocks() {
  vi.mocked(parseIdea).mockImplementation((path) =>
    recordFixture({ path, number: "0001", slug: "probe" }),
  );
  vi.mocked(renderIdea).mockReturnValue("RENDERED");
}
