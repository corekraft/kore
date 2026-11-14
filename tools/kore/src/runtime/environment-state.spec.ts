import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { environmentStatePath } from "./environment-state.js";

// Docs: AGENTS.md "Mutations are serialized per environment."

vi.mock("node:path");

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
});

test("two environments in one checkout keep their state files apart", () => {
  const local = environmentStatePath("/repo", "local", "local-signing.pub");
  const other = environmentStatePath("/repo", "scratch", "local-signing.pub");
  expect(local).toBe("/repo/.kore/state/environments/local/local-signing.pub");
  expect(other).toBe(
    "/repo/.kore/state/environments/scratch/local-signing.pub",
  );
  expect(vi.mocked(join).mock.calls).toEqual([
    ["/repo", ".kore", "state", "environments", "local", "local-signing.pub"],
    ["/repo", ".kore", "state", "environments", "scratch", "local-signing.pub"],
  ]);
});

test("an environment named like a shared state entry cannot collide with it", () => {
  const path = environmentStatePath("/repo", "journal", "reference-api-token");
  expect(path).toBe(
    "/repo/.kore/state/environments/journal/reference-api-token",
  );
  expect(path).not.toBe("/repo/.kore/state/journal/reference-api-token");
});
