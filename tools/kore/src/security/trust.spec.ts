import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { RunOptions, RunResult, Runner } from "../runtime/index.js";
import { issuerManifest, installLocalTrust } from "./trust.js";

test("CA issuer manifest references a generated secret and never embeds key material", () => {
  const manifest = issuerManifest("kore-local-ca", "kore-local-ca-key-pair");
  assert.match(manifest, /kind: ClusterIssuer/);
  assert.match(manifest, /secretName: kore-local-ca-key-pair/);
  assert.doesNotMatch(manifest, /BEGIN (RSA )?PRIVATE KEY/);
});

test("local trust installation ensures the target namespace exists", async () => {
  const repository = await loadRepository("local");
  const calls: {
    command: string;
    args: readonly string[];
    options?: RunOptions;
  }[] = [];
  const runner: Runner = {
    async run(
      command: string,
      args: readonly string[],
      options?: RunOptions,
    ): Promise<RunResult> {
      calls.push({ command, args, ...(options ? { options } : {}) });
      if (command === "minikube") return { stdout: "{}", stderr: "", code: 0 };
      if (command === "kubectl" && args.includes("jsonpath={.metadata.name}"))
        return { stdout: "kube-system", stderr: "", code: 0 };
      if (command === "mkcert" && args[0] === "-CAROOT")
        return { stdout: "/tmp", stderr: "", code: 0 };
      if (
        command === "kubectl" &&
        args.includes("create") &&
        args.includes("secret")
      )
        return {
          stdout: "apiVersion: v1\nkind: Secret\n",
          stderr: "",
          code: 0,
        };
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await installLocalTrust(repository, runner);

  assert.ok(
    calls.some(
      ({ command, args, options }) =>
        command === "kubectl" &&
        args.includes("--filename") &&
        options?.input?.includes("name: kore-system") &&
        options.input.includes("app.kubernetes.io/managed-by: Helm") &&
        options.input.includes(
          "meta.helm.sh/release-name: kore-platform-config",
        ),
    ),
  );
  assert.ok(
    calls.some(
      ({ command, args }) =>
        command === "kubectl" &&
        args.includes("create") &&
        args.includes("secret") &&
        args.includes("--namespace") &&
        args.includes("cert-manager"),
    ),
  );
  assert.ok(
    calls.some(
      ({ command, options }) =>
        command === "kubectl" &&
        options?.input?.includes("name: kore-local-ca"),
    ),
  );
  assert.ok(
    calls.some(
      ({ command, args }) =>
        command === "kubectl" &&
        args.includes("wait") &&
        args.includes("--for=condition=Ready") &&
        args.includes("clusterissuer/kore-local-ca"),
    ),
  );
});
