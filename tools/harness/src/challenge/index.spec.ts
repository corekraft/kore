// Docs: infra/plans/11-agent-delivery-loop.md (Step 3, the challenge stage)
import { expect, test, vi } from "vitest";
import * as challenge from "./index.js";
import { challengeIdea, RoundLimit } from "./challenge.js";
import { MAX_ROUNDS, parseObjections, parseRounds } from "./model.js";

vi.mock("./challenge.js");
vi.mock("./model.js");

test("the challenge barrel exposes exactly the round entry points and the round limit", () => {
  expect(Object.keys(challenge).sort()).toEqual(
    [
      "MAX_ROUNDS",
      "RoundLimit",
      "challengeIdea",
      "parseObjections",
      "parseRounds",
    ].sort(),
  );
});

test("the challenge barrel re-exports each module's own function, and the limit's value", () => {
  expect(challenge.challengeIdea).toBe(challengeIdea);
  expect(challenge.RoundLimit).toBe(RoundLimit);
  expect(challenge.parseRounds).toBe(parseRounds);
  expect(challenge.parseObjections).toBe(parseObjections);
  expect(challenge.MAX_ROUNDS).toBe(MAX_ROUNDS);
});
