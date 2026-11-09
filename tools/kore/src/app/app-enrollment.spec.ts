import { expect, test, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));
import { loadRepository } from "../config/index.js";
import { appUp } from "./up.js";
import type { Runner } from "../runtime/index.js";
import {
  healthyReadinessOutput,
  passthroughRegistry,
  releaseNotFound,
} from "./app-fixtures.js";

test("app up enrolls the application namespace in the ambient mesh before any release installs", async () => {
  const repository = await loadRepository("local");
  const calls: {
    command: string;
    args: readonly string[];
    input?: string | undefined;
  }[] = [];
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
  const image = {
    reference: "registry.kore.local:30500/reference@sha256:" + "a".repeat(64),
    digest: "sha256:" + "a".repeat(64),
    signer: "local-kore-key",
  };
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);

  await appUp(repository, runner, "reference", image, {
    publicKey: "/tmp/kore.pub",
  });

  const enroll = calls.findIndex(
    ({ command, input }) =>
      command === "kubectl" && input?.includes("kind: Namespace"),
  );
  const firstInstall = calls.findIndex(
    ({ command, args }) => command === "helm" && args[0] === "upgrade",
  );
  expect(enroll).toBeGreaterThanOrEqual(0);
  expect(enroll).toBeLessThan(firstInstall);
  expect(calls[enroll]!.args).toContain(repository.environment.kubeContext);
  expect(calls[enroll]!.input).toContain("name: reference");
  expect(calls[enroll]!.input).toContain("istio.io/dataplane-mode: ambient");
  // Helm must not also create the namespace: one owner per resource.
  for (const { command, args } of calls) {
    if (command === "helm") {
      expect(args).not.toContain("--create-namespace");
    }
  }
});
