import { afterEach, expect, test, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));

import { appUpRelease } from "./up.js";
import {
  healthyRunner,
  passthroughRegistry,
  removeReleaseLocks,
  repositoryTrustingRelease,
  writeReleaseLock,
  type Call,
} from "./app-fixtures.js";

afterEach(removeReleaseLocks);

// Docs: docs/decisions/0076-k3d-replaces-minikube.md
test("app up runs no minikube tunnel and no ssh command", async () => {
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const repository = await repositoryTrustingRelease();
  const calls: Call[] = [];
  const lock = await writeReleaseLock(repository.root);

  await appUpRelease(repository, healthyRunner(calls), "reference", lock);

  expect(calls.length).toBeGreaterThan(0);
  expect(
    calls.filter(
      (c) =>
        c.command === "ssh" ||
        (c.command === "minikube" && c.args[0] === "tunnel"),
    ),
  ).toEqual([]);
});
