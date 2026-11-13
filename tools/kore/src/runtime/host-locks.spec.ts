import { homedir } from "node:os";
import { afterEach, expect, test } from "vitest";
import { hostRoot } from "./host-locks.js";

// Docs: AGENTS.md "Mutations are serialized per environment."

const previous = process.env.KORE_HOST_ROOT;

afterEach(() => {
  if (previous === undefined) {
    delete process.env.KORE_HOST_ROOT;
  } else {
    process.env.KORE_HOST_ROOT = previous;
  }
});

test("an empty KORE_HOST_ROOT is unset, so locks stay at the shared home path", () => {
  process.env.KORE_HOST_ROOT = "";
  expect(hostRoot()).toBe(homedir());
});

test("an absolute KORE_HOST_ROOT relocates the locks", () => {
  process.env.KORE_HOST_ROOT = "/somewhere/else";
  expect(hostRoot()).toBe("/somewhere/else");
});

test("a relative KORE_HOST_ROOT is refused, because it would make locks per worktree again", () => {
  process.env.KORE_HOST_ROOT = "relative/dir";
  expect(() => hostRoot()).toThrow(/KORE_HOST_ROOT.*absolute.*relative\/dir/);
});
