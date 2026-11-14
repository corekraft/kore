// Docs: docs/decisions/0104-integration-specs-may-stub-a-domain-s-own-cluster-facing-modules.md
// Stubs (ADR 0104) the platform's own ./reconcile.js, which applies releases to
// the cluster and records each call in `reconciled`, and ./admission-gate.js
// (gate open and close; covered in platform.admission-gate.spec.ts). It also
// stubs the images barrel's signing-key publish.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";

vi.mock("../../src/images/index.js", () => ({
  ensureLocalSigningPublicKey: async () => undefined,
}));
vi.mock("../../src/platform/admission-gate.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/platform/admission-gate.js")
  >()),
  closeExistingAdmissionGate: async () => undefined,
  openAdmissionGate: async () => undefined,
}));
const reconciled: string[] = [];
vi.mock("../../src/platform/reconcile.js", () => ({
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
import { loadRepository } from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { platformUp } from "../../src/platform/index.js";

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
