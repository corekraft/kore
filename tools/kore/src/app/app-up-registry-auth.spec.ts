import { loadRepository } from "../config/index.js";
import { expect, test, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));

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

test("app up verifies with the read-only identity, never the push credential, and runs no node command", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const envs: (NodeJS.ProcessEnv | undefined)[] = [];
  const inner = healthyRunner(calls);
  const runner: Runner = {
    async run(command, args, options) {
      if (command === "cosign") {
        envs.push(options?.env);
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
  const commands = calls.map(({ command }) => command);
  expect(commands).not.toContain("ssh");
  expect(JSON.stringify(calls.map((c) => c.args))).not.toContain(pushPassword);
  expect(JSON.stringify(calls.map((c) => c.args))).not.toContain(readPassword);
});
