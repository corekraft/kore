import { expect, test, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));
import { loadRepository } from "../config/index.js";
import { appUp } from "./up.js";
import { bindCrossplaneSecrets } from "./install.js";
import type { Runner } from "../runtime/index.js";
import {
  healthyReadinessOutput,
  passthroughRegistry,
  releaseNotFound,
} from "./app-fixtures.js";

interface Recorded {
  command: string;
  args: readonly string[];
  input?: string | undefined;
}

test("app up binds Crossplane's Secret role in the application namespace before the claim installs", async () => {
  const repository = await loadRepository("local");
  const calls: Recorded[] = [];
  const runner: Runner = {
    async run(command, args, options) {
      calls.push({ command, args, input: options?.input });
      releaseNotFound(command, args);
      if (command === "helm" && args[0] === "status") {
        return {
          stdout: '{"info":{"status":"deployed"}}',
          stderr: "",
          code: 0,
        };
      }
      if (command === "kubectl" && healthyReadinessOutput(args) !== undefined) {
        return { stdout: healthyReadinessOutput(args)!, stderr: "", code: 0 };
      }
      if (
        command === "kubectl" &&
        args.some((arg) => arg.includes("spec.clusterIP"))
      ) {
        return { stdout: "10.96.0.50", stderr: "", code: 0 };
      }
      if (command === "kubectl" && args.includes("--output=name")) {
        return { stdout: "deployment/reference-api\n", stderr: "", code: 0 };
      }
      if (command === "kubectl" && args.includes("namespace")) {
        return { stdout: "kube-system", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const digest = "sha256:" + "a".repeat(64);

  await appUp(
    repository,
    runner,
    "reference",
    {
      reference: `registry.kore.local:30500/reference@${digest}`,
      digest,
      signer: "local-kore-key",
    },
    "/tmp/kore.pub",
  );

  const bind = calls.findIndex(({ input }) => input?.includes("RoleBinding"));
  const firstInstall = calls.findIndex(
    ({ command, args }) => command === "helm" && args[0] === "upgrade",
  );
  expect(bind).toBeGreaterThanOrEqual(0);
  expect(bind).toBeLessThan(firstInstall);
  const call = calls[bind]!;
  expect(call.args).toContain(repository.environment.kubeContext);
  expect(call.args).toContain("--field-manager=kore-app");
  const binding = JSON.parse(call.input!);
  expect(binding.kind).toBe("RoleBinding");
  expect(binding.metadata.namespace).toBe("reference");
  expect(binding.roleRef).toMatchObject({
    kind: "ClusterRole",
    name: "crossplane-postgresql-secrets",
  });
  expect(binding.subjects).toEqual([
    {
      kind: "ServiceAccount",
      name: "crossplane",
      namespace: "crossplane-system",
    },
  ]);
});

test("Crossplane's Secret role is never bound in kore-system or another platform namespace", async () => {
  const repository = await loadRepository("local");
  for (const namespace of ["kore-system", "crossplane-system", "kube-system"]) {
    const calls: Recorded[] = [];
    const runner: Runner = {
      async run(command, args) {
        calls.push({ command, args });
        return { stdout: "", stderr: "", code: 0 };
      },
    };
    await expect(
      bindCrossplaneSecrets(repository, runner, namespace),
    ).rejects.toThrow(/platform namespace/);
    expect(calls).toEqual([]);
  }
});
