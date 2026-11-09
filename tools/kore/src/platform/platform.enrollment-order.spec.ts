import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";

vi.mock("../images/index.js", () => ({
  ensureLocalSigningPublicKey: async () => undefined,
}));
vi.mock("./admission-gate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./admission-gate.js")>()),
  closeExistingAdmissionGate: async () => undefined,
  openAdmissionGate: async () => undefined,
}));
const reconciled: string[] = [];
vi.mock("./reconcile.js", () => ({
  reconcileComponent: async () => undefined,
  reconcileIfNeeded: async (_r: unknown, _x: unknown, c: { name: string }) => {
    reconciled.push(`reconcile ${c.name}`);
  },
  reconcileConfiguration: async (
    _r: unknown,
    _x: unknown,
    c: { name: string },
  ) => {
    reconciled.push(`reconcile ${c.name}`);
  },
}));
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { platformUp } from "./up.js";

// Docs: docs/decisions/0056-platform-image-inventory.md
// Namespaces are labelled after policy-controller and the image policy are
// ready, and before the inventory and the gate decision.

test("enforce enrolls namespaces after policy-controller and the image policy, before the inventory", async () => {
  const base = await loadRepository("managed-example");
  const root = await mkdtemp(join(tmpdir(), "kore-enrollment-order-"));
  const pick = (name: string) => {
    const component = base.catalog.components.find((c) => c.name === name)!;
    return { ...component, dependencies: [], readiness: [] };
  };
  const repository = {
    ...base,
    root,
    catalog: {
      ...base.catalog,
      components: [
        pick("policy-controller"),
        { ...pick("cert-manager"), dependencies: ["policy-controller"] },
        { ...pick("kore-image-policy"), dependencies: ["policy-controller"] },
      ],
    },
  };
  const calls = reconciled;
  const runner: Runner = {
    async run(command, args) {
      const joined = `${command} ${args.join(" ")}`;
      calls.push(joined);
      if (joined.includes("get namespaces")) {
        return {
          stdout: JSON.stringify({
            items: ["cosign-system", "cert-manager"].map((name) => ({
              metadata: { name },
            })),
          }),
          stderr: "",
          code: 0,
        };
      }
      if (joined.includes("get pods")) {
        return { stdout: '{"items":[]}', stderr: "", code: 0 };
      }
      if (command === "helm") {
        return {
          stdout: JSON.stringify({ info: { status: "deployed" } }),
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "available", stderr: "", code: 0 };
    },
  };
  try {
    await platformUp(repository, runner).catch(() => undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const at = (needle: string) => calls.findIndex((c) => c.includes(needle));
  const controller = at("reconcile policy-controller");
  const policy = at("reconcile kore-image-policy");
  const label = at("--field-manager=kore-enrollment");
  const inventory = at("get pods");
  assert.ok(controller >= 0 && policy > controller);
  assert.ok(label > policy, "label after the image policy");
  assert.ok(inventory === -1 || label < inventory);
});
