import { expect, test, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));
import { loadRepository } from "../config/index.js";
import { platformGeneration } from "../platform/admission-gate.js";
import { appUp } from "./up.js";
import {
  gateOutput,
  healthyReadinessOutput,
  passthroughRegistry,
} from "./app-fixtures.js";
import type { Runner } from "../runtime/index.js";

test("app up rejects an invalid application name before resolving chart paths", async () => {
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const base = await loadRepository("local");
  const repository = {
    ...base,
    catalog: { components: [] },
  };
  const runner: Runner = {
    async run(command, args) {
      if (command === "minikube") {
        return { stdout: '{"Host":"Running"}', stderr: "", code: 0 };
      }
      if (
        command === "kubectl" &&
        (args.includes("oci-registry-credentials") ||
          args.includes("oci-registry-tls"))
      ) {
        return { stdout: healthyReadinessOutput(args)!, stderr: "", code: 0 };
      }
      if (
        command === "kubectl" &&
        args.includes("koreapplicationadmission.constraints.gatekeeper.sh")
      ) {
        return {
          stdout: gateOutput("open", platformGeneration(repository)),
          stderr: "",
          code: 0,
        };
      }
      if (command === "kubectl" && args.includes("jsonpath={.metadata.name}")) {
        return { stdout: "kube-system", stderr: "", code: 0 };
      }
      if (
        command === "kubectl" &&
        args.some((arg) => arg.includes(".spec.clusterIP"))
      ) {
        return { stdout: "10.96.0.50", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  await expect(
    appUp(
      repository,
      runner,
      "Bad_Name",
      {
        reference: "registry.kore.local/reference@sha256:" + "a".repeat(64),
        digest: "sha256:" + "a".repeat(64),
        signer: "local-kore-key",
      },
      { publicKey: "/tmp/kore.pub" },
    ),
  ).rejects.toThrow(/invalid application name/);
});
