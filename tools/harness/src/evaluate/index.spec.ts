import { expect, test, vi } from "vitest";
import * as evaluate from "./evaluate.js";
import * as barrel from "./index.js";

vi.mock("./evaluate.js", () => ({ evaluateIdea: "evaluateIdea" }));

test("the evaluate barrel exposes exactly evaluateIdea", () => {
  expect(Object.keys(barrel)).toEqual(["evaluateIdea"]);
});

test("the evaluate barrel maps evaluateIdea to the evaluate module's own export", () => {
  expect(barrel.evaluateIdea).toBe(evaluate.evaluateIdea);
});
