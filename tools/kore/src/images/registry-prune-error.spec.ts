import { expect, test } from "vitest";
import { RegistryPruneError } from "./registry-prune-error.js";

// Docs: docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md

test("a registry prune error is an Error that carries its message, so a caller can tell it from a bug and still report it", () => {
  const error = new RegistryPruneError("registry answered 405");
  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(RegistryPruneError);
  expect(error.message).toBe("registry answered 405");
});

test("a plain Error is not a registry prune error, so a bug is never mistaken for an expected refusal", () => {
  expect(new Error("bug")).not.toBeInstanceOf(RegistryPruneError);
});
