import { loadMinikubeLocal } from "../config/minikube-local-support.js";
import { afterEach, test, expect, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));

import type { Runner } from "../runtime/index.js";
import { appUp, appUpRelease } from "./up.js";
import {
  healthyRunner,
  lockedImage,
  passthroughRegistry,
  removeReleaseLocks,
  repositoryTrustingRelease,
  writeReleaseLock,
  type Call,
} from "./app-fixtures.js";

afterEach(removeReleaseLocks);

test.each(["appUp", "appUpRelease"] as const)(
  "%s binds Crossplane's Secret access before the first chart is installed",
  async (path) => {
    const repository =
      path === "appUp"
        ? await loadMinikubeLocal()
        : await repositoryTrustingRelease();
    const calls: Call[] = [];
    const inputs: string[] = [];
    const base = healthyRunner(calls);
    const runner: Runner = {
      async run(command, args, runOptions) {
        inputs[calls.length] = runOptions?.input ?? "";
        return await base.run(command, args, runOptions);
      },
    };
    localRegistryReferenceMock.mockImplementation(passthroughRegistry);
    const options = path === "appUp" ? { publicKey: "/tmp/kore.pub" } : {};
    if (path === "appUp") {
      await appUp(repository, runner, "reference", lockedImage(), options);
    } else {
      await appUpRelease(
        repository,
        runner,
        "reference",
        await writeReleaseLock(repository.root),
        options,
      );
    }
    const bound = calls.findIndex(
      (_call, index) =>
        inputs[index]?.includes('"kind":"RoleBinding"') === true &&
        inputs[index]?.includes("crossplane-postgresql-secrets") === true,
    );
    const firstInstall = calls.findIndex(
      ({ command, args }) => command === "helm" && args[0] === "upgrade",
    );
    expect(bound).toBeGreaterThanOrEqual(0);
    expect(firstInstall).toBeGreaterThan(bound);
  },
);
