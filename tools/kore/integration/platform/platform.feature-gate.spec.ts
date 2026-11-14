// Docs: docs/decisions/0104-integration-specs-may-stub-a-domain-s-own-cluster-facing-modules.md
// Stubs (ADR 0104) the platform's own ./enrollment.js (namespace labels; covered
// in enrollment.spec.ts) and ./admission-gate.js (gate open and close; covered in
// platform.admission-gate.spec.ts). It also stubs the images and security
// barrels' publish, registry and trust calls, which are covered in their own specs.
import assert from "node:assert/strict";
import { test, vi } from "vitest";

vi.mock("../../src/platform/enrollment.js", () => ({
  enrollPlatformNamespaces: async () => undefined,
}));
vi.mock("../../src/images/index.js", () => ({
  ensureLocalSigningPublicKey: async () => undefined,
  ensureRegistryAuth: async () => undefined,
  ensureRegistryTrust: async () => undefined,
  registryTrustProblem: async () => undefined,
}));
vi.mock("../../src/platform/admission-gate.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/platform/admission-gate.js")
  >()),
  closeExistingAdmissionGate: async () => undefined,
  openAdmissionGate: async () => undefined,
  assertAdmissionGateOpen: async () => "g",
}));
vi.mock("../../src/security/index.js", () => ({
  installLocalTrust: async () => undefined,
}));
import {
  loadRepository,
  type Component,
  type Repository,
} from "../../src/config/index.js";
import { CommandError, type Runner } from "../../src/runtime/index.js";
import { evaluateReadiness } from "../../src/testing/index.js";
import {
  bootstrapControllers,
  platformStatus,
  platformUp,
} from "../../src/platform/index.js";

const deployed = JSON.stringify({ info: { status: "deployed" } });

async function repositoryWith(on: boolean): Promise<Repository> {
  const base = await loadRepository("local");
  const helm = base.catalog.components.find((c) => c.kind === "helm")!;
  const component = (name: string, phase: Component["phase"]): Component => ({
    ...helm,
    name,
    phase,
    dependencies: [],
    readiness: ["configmap/ready"],
  });
  const gatedCore = {
    ...component("gated-core", "core"),
    featureFlag: "agent-ingress",
  };
  const gatedConfiguration = {
    ...component("gated-configuration", "configuration"),
    featureFlag: "agent-ingress",
    dependencies: ["gated-core"],
  };
  return {
    ...base,
    catalog: {
      ...base.catalog,
      components: [gatedCore, component("sibling", "core"), gatedConfiguration],
    },
    environment: {
      ...base.environment,
      provider: "managed",
      features: { "agent-ingress": on },
    },
  };
}

function fake() {
  const calls: string[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push(`${command} ${args.join(" ")}`);
      let stdout = "";
      if (
        command === "helm" &&
        args[0] === "status" &&
        args[1]!.startsWith("gated-")
      ) {
        throw new CommandError(command, args, {
          stdout: "",
          stderr: "Error: release: not found",
          code: 1,
        });
      }
      if (command === "helm") {
        stdout = args[0] === "history" ? "[]" : deployed;
      }
      return { stdout, stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

test("with the flag off, bootstrap issues no command that mentions the gated component", async () => {
  const repository = await repositoryWith(false);
  const { runner, calls } = fake();
  await bootstrapControllers(repository, runner);
  assert.ok(calls.some((c) => c.includes("sibling")));
  assert.equal(
    calls.filter((c) => c.includes("gated-") && !c.startsWith("helm status "))
      .length,
    0,
  );
});

test("with the flag on, bootstrap touches the gated component", async () => {
  const repository = await repositoryWith(true);
  const { runner, calls } = fake();
  await bootstrapControllers(repository, runner);
  assert.ok(calls.some((c) => c.includes("gated-")));
});

test("platform up with the flag off never installs the gated component", async () => {
  const repository = await repositoryWith(false);
  const { runner, calls } = fake();
  repository.readiness = { ...repository.readiness, requirements: [] };
  await platformUp(repository, runner);
  assert.equal(
    calls.filter((c) => c.includes("gated-") && !c.startsWith("helm status "))
      .length,
    0,
  );
});

test("status reports a gated-off component as gated off, not missing, and runs no command for it", async () => {
  const repository = await repositoryWith(false);
  const { runner, calls } = fake();
  const rows = await platformStatus(repository, runner, ["gated-core"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "gated-off");
  assert.match(rows[0]!.detail, /agent-ingress/);
  assert.ok(calls.every((c) => c.startsWith("helm status gated-core ")));
});

test("a gated-on component is probed like any other", async () => {
  const repository = await repositoryWith(true);
  const { runner, calls } = fake();
  const rows = await platformStatus(repository, runner, ["gated-core"]);
  assert.notEqual(rows[0]!.status, "gated-off");
  assert.ok(calls.length > 0);
});

test("a gated-off prerequisite does not close the admission gate", async () => {
  const repository = await repositoryWith(false);
  repository.readiness = {
    ...repository.readiness,
    requirements: [
      { name: "r", step: 1, capability: "c", components: ["gated-core"] },
    ],
  } as never;
  const evidence = evaluateReadiness(repository, [
    { name: "gated-core", namespace: "x", status: "gated-off", detail: "off" },
  ]);
  assert.equal(evidence.state, "open");
});

test("platform up with the flag on installs gated components in dependency order", async () => {
  const repository = await repositoryWith(true);
  const { runner, calls } = fake();
  repository.readiness = { ...repository.readiness, requirements: [] };
  await platformUp(repository, runner);
  const upgrades = calls
    .filter((c) => c.startsWith("helm upgrade"))
    .map((c) => /upgrade --install (\S+)/.exec(c)![1]);
  assert.deepEqual(upgrades, ["gated-core", "sibling", "gated-configuration"]);
});
