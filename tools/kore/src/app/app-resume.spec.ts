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

/** A cluster where an earlier `app up` died with the workload release failed. */
function interrupted(calls: Call[]): Runner {
  const inner = healthyRunner(calls);
  let workloadGone = false;
  return {
    async run(command, args, options) {
      if (
        command === "helm" &&
        args[0] === "history" &&
        args[1] === "reference"
      ) {
        if (workloadGone) {
          return inner.run(command, args, options);
        }
        calls.push({ command, args });
        return {
          stdout: JSON.stringify([{ revision: 1, status: "failed" }]),
          stderr: "",
          code: 0,
        };
      }
      if (command === "helm" && args[0] === "uninstall") {
        workloadGone = true;
      }
      return inner.run(command, args, options);
    },
  };
}

test("a rerun after an interrupted attempt clears only the failed release, then converges", async () => {
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const repository = await repositoryTrustingRelease();
  const calls: Call[] = [];

  await appUpRelease(
    repository,
    interrupted(calls),
    "reference",
    await writeReleaseLock(repository.root),
  );

  const helm = calls
    .filter((c) => c.command === "helm")
    .map((c) =>
      c.args[0] === "upgrade"
        ? `upgrade ${c.args[2]}`
        : `${c.args[0]} ${c.args[1]}`,
    );
  expect(helm).toContain("uninstall reference");
  expect(helm).not.toContain("uninstall reference-resources");
  expect(helm.indexOf("uninstall reference")).toBeLessThan(
    helm.indexOf("upgrade reference"),
  );
  // Cleanup precedes every install, so a stuck release never blocks the upgrade.
  expect(helm.indexOf("uninstall reference")).toBeLessThan(
    helm.indexOf("upgrade reference-resources"),
  );
});
