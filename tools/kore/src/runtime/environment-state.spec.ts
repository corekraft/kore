import { expect, test } from "vitest";
import { environmentStatePath } from "./environment-state.js";

// Docs: AGENTS.md "Mutations are serialized per environment."

test("two environments in one checkout keep their state files apart", () => {
  const local = environmentStatePath("/repo", "local", "local-signing.pub");
  const other = environmentStatePath("/repo", "scratch", "local-signing.pub");
  expect(local).toBe("/repo/.kore/state/environments/local/local-signing.pub");
  expect(other).not.toBe(local);
});

test("an environment named like a shared state entry cannot collide with it", () => {
  const path = environmentStatePath("/repo", "journal", "reference-api-token");
  expect(path).toBe(
    "/repo/.kore/state/environments/journal/reference-api-token",
  );
});
