import { loadMinikubeLocal } from "../config/minikube-local.fixtures.js";
import { afterEach, expect, test, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));

import { appUp, appUpRelease } from "./up.js";
import {
  gateOutput,
  healthyRunner,
  lockedImage,
  passthroughRegistry,
  removeReleaseLocks,
  repositoryTrustingRelease,
  writeReleaseLock,
  type Call,
} from "./app-fixtures.js";

// Docs: docs/decisions/0060-tunnel-recovery-on-demand.md
// A dead tunnel is restarted by the command that needs the endpoint, after the
// platform is proven ready and before any workload is installed.

afterEach(removeReleaseLocks);

const isInstall = (call: Call) =>
  call.command === "helm" && call.args[0] === "upgrade";

test("app up restores the tunnel after the platform checks and before installing", async () => {
  const repository = await loadMinikubeLocal();
  const calls: Call[] = [];
  const order: string[] = [];
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);

  await appUp(repository, healthyRunner(calls), "reference", lockedImage(), {
    publicKey: "/tmp/kore.pub",
    ensureTunnel: async () => {
      order.push("tunnel");
      expect(calls.some(isInstall)).toBe(false);
      expect(
        calls.some((call) =>
          call.args.includes(
            "koreapplicationadmission.constraints.gatekeeper.sh",
          ),
        ),
      ).toBe(true);
    },
  });

  expect(order).toEqual(["tunnel"]);
  expect(calls.some(isInstall)).toBe(true);
});

test("app up does not touch the tunnel while the gate is closed", async () => {
  const repository = await loadMinikubeLocal();
  const ensureTunnel = vi.fn(async () => {});
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const inner = healthyRunner([]);

  await expect(
    appUp(
      repository,
      {
        async run(command, args, options) {
          if (
            args.includes("koreapplicationadmission.constraints.gatekeeper.sh")
          ) {
            return { stdout: gateOutput("closed"), stderr: "", code: 0 };
          }
          return inner.run(command, args, options);
        },
      },
      "reference",
      lockedImage(),
      { publicKey: "/tmp/kore.pub", ensureTunnel },
    ),
  ).rejects.toThrow(/closed/);
  expect(ensureTunnel).not.toHaveBeenCalled();
});

test("app up from the release lock restores the tunnel after admission and before verifying or deploying", async () => {
  const repository = await repositoryTrustingRelease();
  const calls: Call[] = [];
  let atTunnel: Call[] = [];
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);

  await appUpRelease(
    repository,
    healthyRunner(calls),
    "reference",
    await writeReleaseLock(repository.root),
    {
      ensureTunnel: async () => {
        atTunnel = [...calls];
      },
    },
  );

  const gateRead = atTunnel.some((call) =>
    call.args.includes("koreapplicationadmission.constraints.gatekeeper.sh"),
  );
  expect(gateRead).toBe(true);
  expect(atTunnel.some((call) => call.command === "cosign")).toBe(false);
  expect(atTunnel.some(isInstall)).toBe(false);
  expect(calls.some((call) => call.command === "cosign")).toBe(true);
  expect(calls.some(isInstall)).toBe(true);
});
