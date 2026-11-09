import { expect, test, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));
import { loadRepository } from "../config/index.js";
import { appUp } from "./up.js";
import {
  healthyRunner,
  lockedImage,
  passthroughRegistry,
  pushPassword,
  readPassword,
  type Call,
} from "./app-fixtures.js";
import type { Runner } from "../runtime/index.js";

test("app up verifies and pulls with the read-only identity, never the push credential", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const inputs: (string | undefined)[] = [];
  const envs: (NodeJS.ProcessEnv | undefined)[] = [];
  const inner = healthyRunner(calls);
  const runner: Runner = {
    async run(command, args, options) {
      if (command === "cosign") {
        envs.push(options?.env);
      }
      if (command === "minikube" && args[0] === "ssh") {
        inputs.push(options?.input);
      }
      return await inner.run(command, args, options);
    },
  };
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);

  await appUp(repository, runner, "reference", lockedImage(), {
    publicKey: "/tmp/kore.pub",
  });

  expect(envs[0]?.["KORE_REGISTRY_USERNAME"]).toBe("kore-read");
  expect(envs[0]?.["KORE_REGISTRY_PASSWORD"]).toBe(readPassword);
  expect(inputs).toEqual([`${readPassword}\n`]);
  expect(JSON.stringify(calls.map((c) => c.args))).not.toContain(pushPassword);
  expect(JSON.stringify(calls.map((c) => c.args))).not.toContain(readPassword);
});
