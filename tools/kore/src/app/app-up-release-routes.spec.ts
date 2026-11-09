import { afterEach, expect, test, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));
import type { Runner } from "../runtime/index.js";
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

// Docs: docs/decisions/0013-local-tls-before-gateway.md
// Deploying from a release lock reports success only after the rendered
// HTTPRoutes are ready, exactly like deploying a source build.

test("app up from a release lock waits for the rendered HTTPRoute after the rollout", async () => {
  const repository = await repositoryTrustingRelease();
  const calls: Call[] = [];
  const inner = healthyRunner(calls);
  const accepted = JSON.stringify({
    status: {
      parents: [
        {
          conditions: [
            { type: "Accepted", status: "True" },
            { type: "ResolvedRefs", status: "True" },
          ],
        },
      ],
    },
  });
  const runner: Runner = {
    async run(command, args, options) {
      if (command === "helm" && args[0] === "get" && args[1] === "manifest") {
        calls.push({ command, args });
        return {
          stdout:
            args[2] === "reference"
              ? "---\napiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: web\nspec: {}\n"
              : "",
          stderr: "",
          code: 0,
        };
      }
      if (command === "kubectl" && args.includes("httproute/web")) {
        calls.push({ command, args });
        return { stdout: accepted, stderr: "", code: 0 };
      }
      return inner.run(command, args, options);
    },
  };
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);

  await appUpRelease(
    repository,
    runner,
    "reference",
    await writeReleaseLock(repository.root),
  );

  const route = calls.findIndex(({ args }) => args.includes("httproute/web"));
  const rollout = calls.findLastIndex(({ args }) => args.includes("rollout"));
  expect(route).toBeGreaterThan(rollout);
});
