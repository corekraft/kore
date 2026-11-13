import { loadRepository } from "../config/index.js";
import { expect, test, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));

import type { Runner } from "../runtime/index.js";
import { admissionGate } from "../platform/index.js";
import { appUp } from "./up.js";
import {
  gateOutput,
  healthyRunner,
  lockedImage,
  passthroughRegistry,
  type Call,
} from "../testing/index.js";

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

const isGateRead = (call: Call) =>
  call.args.includes("koreapplicationadmission.constraints.gatekeeper.sh");

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
        publicKey: "/tmp/kore.pub",
      }),
    ).rejects.toThrow(message);

    // The gate read is the last thing app up does: no signature check, image
    // staging, namespace write, or release follows it.
    expect(calls.findLastIndex(isGateRead)).toBe(calls.length - 1);
  },
);

test("app up activates the namespace for the open gate's generation before installing any release", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);

  await appUp(
    repository,
    withGate(calls, gateOutput("open")),
    "reference",
    lockedImage(),
    { publicKey: "/tmp/kore.pub" },
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
    publicKey: "/tmp/kore.pub",
  });

  expect(calls.some((call) => call.args[0] === "upgrade")).toBe(true);
});
