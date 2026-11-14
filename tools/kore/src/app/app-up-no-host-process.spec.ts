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
} from "../testing/index.js";

afterEach(removeReleaseLocks);

// Docs: docs/decisions/0085-k3d-gateway-answers-through-a-node-port.md
test("app up runs no tunnel, no ssh and no docker exec", async () => {
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
        c.args[0] === "tunnel" ||
        (c.command === "docker" && c.args[0] === "exec"),
    ),
  ).toEqual([]);
});
