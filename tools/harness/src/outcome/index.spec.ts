import { expect, test, vi } from "vitest";
import * as model from "./model.js";
import * as outcome from "./outcome.js";
import * as barrel from "./index.js";

vi.mock("./outcome.js", () => ({
  closeOutcome: "closeOutcome",
  recordOutcome: "recordOutcome",
}));
vi.mock("./model.js", () => ({
  OUTCOME_KINDS: "OUTCOME_KINDS",
  OUTCOME_SOURCES: "OUTCOME_SOURCES",
  RESULTS: "RESULTS",
  labelFor: "labelFor",
  parseOutcome: "parseOutcome",
}));

test("the outcome barrel exposes exactly the recording, closing and vocabulary names", () => {
  expect(Object.keys(barrel).sort()).toEqual([
    "OUTCOME_KINDS",
    "OUTCOME_SOURCES",
    "RESULTS",
    "closeOutcome",
    "labelFor",
    "parseOutcome",
    "recordOutcome",
  ]);
});

test("the outcome barrel maps each function name to the outcome module's own export", () => {
  expect(barrel.recordOutcome).toBe(outcome.recordOutcome);
  expect(barrel.closeOutcome).toBe(outcome.closeOutcome);
});

test("the outcome barrel maps each vocabulary and helper name to the model's own export", () => {
  expect(barrel.OUTCOME_KINDS).toBe(model.OUTCOME_KINDS);
  expect(barrel.OUTCOME_SOURCES).toBe(model.OUTCOME_SOURCES);
  expect(barrel.RESULTS).toBe(model.RESULTS);
  expect(barrel.labelFor).toBe(model.labelFor);
  expect(barrel.parseOutcome).toBe(model.parseOutcome);
});
