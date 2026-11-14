import { expect, it, vi } from "vitest";
import * as commands from "./commands.js";
import * as idea from "./index.js";
import * as record from "./record.js";
import * as repository from "./repository.js";
import * as sync from "./sync.js";

// The barrel only re-exports its four files, so each is mocked: the barrel is
// tested as a pass-through, not as the units behind it.
vi.mock("./commands.js");
vi.mock("./record.js");
vi.mock("./repository.js");
vi.mock("./sync.js");

it("the idea barrel exposes exactly the names its callers import", () => {
  expect(Object.keys(idea).sort()).toEqual([
    "IdeaError",
    "IdeaRepository",
    "SAFETY_PATTERNS",
    "ideaCommands",
    "issueTarget",
    "outcomeSection",
  ]);
});

it("each export is the unit's own export, not a copy or a wrapper", () => {
  expect(idea.ideaCommands).toBe(commands.ideaCommands);
  expect(idea.IdeaRepository).toBe(repository.IdeaRepository);
  expect(idea.IdeaError).toBe(record.IdeaError);
  expect(idea.SAFETY_PATTERNS).toBe(record.SAFETY_PATTERNS);
  expect(idea.outcomeSection).toBe(record.outcomeSection);
  expect(idea.issueTarget).toBe(sync.issueTarget);
});
