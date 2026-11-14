// Docs: docs/decisions/0063-lifecycle-resume-and-release-only-app-up.md
// Real units together, no cluster: app up through its own units, the platform
// gate, the image lock and verification. Only the runner (a recorded fake
// cluster) and the registry lookup are faked. The unit specs in src/app cover
// each unit alone.
import { afterEach, expect, test, vi } from "vitest";
import { appUp, appUpRelease } from "../src/app/index.js";
import { loadRepository } from "../src/config/index.js";
import { admissionGate } from "../src/platform/index.js";
import { CommandError, type Runner } from "../src/runtime/index.js";
import {
  gateOutput,
  healthyRunner,
  lockedImage,
  passthroughRegistry,
  pushPassword,
  readPassword,
  releaseSigner,
  removeReleaseLocks,
  repositoryTrustingRelease,
  writeReleaseLock,
  type Call,
} from "../src/testing/index.js";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../src/images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));

afterEach(removeReleaseLocks);

const publicKey = "/tmp/kore.pub";
const isGateRead = (call: Call) =>
  call.args.includes("koreapplicationadmission.constraints.gatekeeper.sh");
const helmUpgrades = (calls: Call[]) =>
  calls.filter((c) => c.command === "helm" && c.args[0] === "upgrade");
const cosignCalls = (calls: Call[]) =>
  calls.filter((c) => c.command === "cosign");
const isNodeShell = (c: Call) =>
  c.command === "ssh" ||
  c.args[0] === "tunnel" ||
  (c.command === "docker" && c.args[0] === "exec");

/** A healthy cluster whose admission gate reads back as `gate`. */
function withGate(calls: Call[], gate: string | undefined): Runner {
  const inner = healthyRunner(calls);
  return {
    async run(command, args, options) {
      if (args.includes("koreapplicationadmission.constraints.gatekeeper.sh")) {
        calls.push({ command, args });
        return { stdout: gate ?? "", stderr: "", code: 0 };
      }
      return inner.run(command, args, options);
    },
  };
}

test.each([
  ["closed", gateOutput("closed"), /closed/],
  ["absent", undefined, /does not exist.*kore platform up/s],
  ["stale", gateOutput("open", "g-000000000000"), /stale/],
])(
  "app up refuses before touching the cluster while the gate is %s",
  async (_name, gate, message) => {
    const repository = await loadRepository("local");
    const calls: Call[] = [];
    localRegistryReferenceMock.mockImplementation(passthroughRegistry);

    await expect(
      appUp(repository, withGate(calls, gate), "reference", lockedImage(), {
        publicKey,
      }),
    ).rejects.toThrow(message);

    // The gate read is the last thing app up does: no signature check, image
    // staging, namespace write, or release follows it.
    expect(calls.findLastIndex(isGateRead)).toBe(calls.length - 1);
  },
);

test("app up activates the namespace for the open gate's generation before the first release installs", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);

  await appUp(
    repository,
    withGate(calls, gateOutput("open")),
    "reference",
    lockedImage(),
    {
      publicKey,
    },
  );

  const text = calls.map((call) => `${call.command} ${call.args.join(" ")}`);
  const activated = text.findIndex((line) =>
    line.includes("--field-manager=kore-activation"),
  );
  const firstRelease = text.findIndex((line) =>
    line.startsWith("helm upgrade"),
  );
  expect(activated).toBeGreaterThan(-1);
  expect(activated).toBeLessThan(firstRelease);
});

test("app up proceeds once platform up has opened the gate it left behind", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  // The gate as `platform up` writes it when every component is ready.
  const opened = JSON.stringify(admissionGate(repository, "open"));

  await appUp(repository, withGate(calls, opened), "reference", lockedImage(), {
    publicKey,
  });

  expect(helmUpgrades(calls).length).toBeGreaterThan(0);
});

test("app up runs no tunnel, no ssh and no docker exec", async () => {
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const repository = await repositoryTrustingRelease();
  const calls: Call[] = [];
  const lock = await writeReleaseLock(repository.root);

  await appUpRelease(repository, healthyRunner(calls), "reference", lock);

  expect(calls.length).toBeGreaterThan(0);
  expect(calls.filter(isNodeShell)).toEqual([]);
});

test("app up verifies with the read-only registry identity, never the push credential, and runs no node command", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const envs: (Record<string, string | undefined> | undefined)[] = [];
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

  await appUp(repository, runner, "reference", lockedImage(), { publicKey });

  expect(envs[0]?.["KORE_REGISTRY_USERNAME"]).toBe("kore-read");
  expect(envs[0]?.["KORE_REGISTRY_PASSWORD"]).toBe(readPassword);
  expect(calls.filter(isNodeShell)).toEqual([]);
  const sent = JSON.stringify(calls.map((c) => c.args));
  expect(sent).not.toContain(pushPassword);
  expect(sent).not.toContain(readPassword);
});

test("app up refuses a lock entry signed by the local developer key before any signature check or Helm call", async () => {
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const lock = await writeReleaseLock(repository.root, "local-kore-key");

  await expect(
    appUpRelease(repository, healthyRunner(calls), "reference", lock),
  ).rejects.toThrow(/local-kore-key.*release automation.*kore local up/s);

  expect(cosignCalls(calls)).toEqual([]);
  expect(helmUpgrades(calls)).toEqual([]);
});

test("app up refuses the committed placeholder lock, which carries the local key", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  await expect(
    appUp(repository, healthyRunner(calls), "reference"),
  ).rejects.toThrow(/not release automation/);
  expect(helmUpgrades(calls)).toEqual([]);
});

test("app up deploys a release-automation lock entry offline, verifying its exact workflow identity", async () => {
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const repository = await repositoryTrustingRelease();
  const calls: Call[] = [];
  const lock = await writeReleaseLock(repository.root);

  await appUpRelease(repository, healthyRunner(calls), "reference", lock);

  const verify = cosignCalls(calls).find((c) => c.args[0] === "verify");
  expect(verify?.args).toEqual(
    expect.arrayContaining([
      "--certificate-identity",
      releaseSigner,
      "--certificate-oidc-issuer",
      "https://token.actions.githubusercontent.com",
    ]),
  );
  expect(verify?.args).not.toContain("--key");
  expect(helmUpgrades(calls).map((c) => c.args[2])).toEqual([
    "reference-resources",
    "reference",
  ]);
});

test("a local developer-signed image is accepted only on k3d, from kore local up", async () => {
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const base = await loadRepository("local");
  const managed = {
    ...base,
    environment: { ...base.environment, provider: "managed" as const },
  };
  const calls: Call[] = [];

  await expect(
    appUp(managed, healthyRunner(calls), "reference", lockedImage(), {
      publicKey,
    }),
  ).rejects.toThrow(/k3d.*local-kore-key.*managed/s);
  expect(helmUpgrades(calls)).toEqual([]);
});

test("a release-signed entry from an identity the environment does not trust is refused on local with the remedy, before Helm", async () => {
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const lock = await writeReleaseLock(repository.root);

  await expect(
    appUpRelease(repository, healthyRunner(calls), "reference", lock),
  ).rejects.toThrow(
    /image signer .*release\.yaml@refs\/tags\/v0\.3\.1 is not trusted by environment local.*relock the image with that identity/s,
  );

  expect(cosignCalls(calls)).toEqual([]);
  expect(helmUpgrades(calls)).toEqual([]);
});

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
        calls.push({ command, args });
        if (description === undefined) {
          throw new CommandError(command, args, {
            stdout: "",
            stderr: "Error: release: not found",
            code: 1,
          });
        }
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

test("a changed gateway hostname upgrades both app releases on the next app up", async () => {
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const runner = statefulCluster(calls);
  await appUp(repository, runner, "reference", lockedImage(), { publicKey });
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

  await appUp(moved, runner, "reference", lockedImage(), { publicKey });

  expect(helmUpgrades(calls).map((c) => c.args[2])).toEqual([
    "reference-resources",
    "reference",
  ]);
});
