import { loadRepository } from "../config/index.js";
import { expect, test, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));

import { CommandError, type Runner } from "../runtime/index.js";
import { appUp } from "./up.js";
import {
  healthyRunner,
  lockedImage,
  passthroughRegistry,
  type Call,
} from "../testing/index.js";

/**
 * A healthy cluster that remembers each release's revision description, as
 * Helm does, so a second `kore app up` sees what the first one deployed.
 */
function statefulCluster(calls: Call[]): Runner {
  const descriptions = new Map<string, string>();
  const healthy = healthyRunner(calls);
  return {
    async run(command, args, options) {
      if (command === "helm" && args[0] === "history") {
        const description = descriptions.get(args[1]!);
        if (description === undefined) {
          calls.push({ command, args });
          throw new CommandError(command, args, {
            stdout: "",
            stderr: "Error: release: not found",
            code: 1,
          });
        }
        calls.push({ command, args });
        return {
          stdout: JSON.stringify([
            { revision: 1, status: "deployed", description },
          ]),
          stderr: "",
          code: 0,
        };
      }
      if (command === "helm" && args[0] === "upgrade") {
        const at = args.indexOf("--description");
        descriptions.set(args[2]!, at < 0 ? "Upgrade complete" : args[at + 1]!);
      }
      return healthy.run(command, args, options);
    },
  };
}

const upgraded = (calls: Call[]) =>
  calls
    .filter((c) => c.command === "helm" && c.args[0] === "upgrade")
    .map((c) => c.args[2]);

async function setup() {
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  return { repository, calls, runner: statefulCluster(calls) };
}

test("a first app up installs both releases, recording what they were deployed from", async () => {
  const { repository, calls, runner } = await setup();
  await appUp(repository, runner, "reference", lockedImage(), {
    publicKey: "/tmp/kore.pub",
  });
  expect(upgraded(calls)).toEqual(["reference-resources", "reference"]);
  for (const call of calls.filter(
    (c) => c.command === "helm" && c.args[0] === "upgrade",
  )) {
    const at = call.args.indexOf("--description");
    expect(call.args[at + 1]).toMatch(
      /^kore desired-state sha256:[0-9a-f]{64}$/,
    );
  }
});

test("a second app up of unchanged desired state upgrades no release", async () => {
  const { repository, calls, runner } = await setup();
  await appUp(repository, runner, "reference", lockedImage(), {
    publicKey: "/tmp/kore.pub",
  });
  calls.length = 0;
  await appUp(repository, runner, "reference", lockedImage(), {
    publicKey: "/tmp/kore.pub",
  });
  expect(upgraded(calls)).toEqual([]);
});

test("a skipped app release is still awaited for readiness", async () => {
  const { repository, calls, runner } = await setup();
  await appUp(repository, runner, "reference", lockedImage(), {
    publicKey: "/tmp/kore.pub",
  });
  calls.length = 0;
  await appUp(repository, runner, "reference", lockedImage(), {
    publicKey: "/tmp/kore.pub",
  });
  expect(
    calls.some((c) => c.command === "kubectl" && c.args.includes("rollout")),
  ).toBe(true);
});

test("a new image digest upgrades only the workload release", async () => {
  const { repository, calls, runner } = await setup();
  await appUp(repository, runner, "reference", lockedImage(), {
    publicKey: "/tmp/kore.pub",
  });
  calls.length = 0;
  const next = { ...lockedImage(), digest: "sha256:" + "b".repeat(64) };
  next.reference = next.reference.replace(/@.*/, `@${next.digest}`);
  await appUp(repository, runner, "reference", next, {
    publicKey: "/tmp/kore.pub",
  });
  expect(upgraded(calls)).toEqual(["reference"]);
});

test("a changed gateway hostname upgrades both app releases", async () => {
  const { repository, calls, runner } = await setup();
  await appUp(repository, runner, "reference", lockedImage(), {
    publicKey: "/tmp/kore.pub",
  });
  calls.length = 0;
  const moved = {
    ...repository,
    environment: {
      ...repository.environment,
      gateway: {
        ...repository.environment.gateway,
        hostname: "moved.kore.local",
      },
    },
  };
  await appUp(moved, runner, "reference", lockedImage(), {
    publicKey: "/tmp/kore.pub",
  });
  expect(upgraded(calls)).toEqual(["reference-resources", "reference"]);
});
