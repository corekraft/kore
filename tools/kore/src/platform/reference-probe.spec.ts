import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Call } from "../app/app-fixtures.js";
import { CommandError, type Runner } from "../runtime/index.js";
import {
  meshProbePod,
  parseProbeOutcome,
  runMeshProbe,
} from "./reference-probe.js";

// Docs: docs/decisions/0007-workload-identity-and-layered-authorization.md
// The in-mesh probe the opt-in live reference spec uses to prove that an
// undeclared workload identity is refused; fast tests fake the runner.

const image = `10.96.0.50:5000/reference@sha256:${"c".repeat(64)}`;
const url = "http://reference-api:8080/api";

test("the probe pod runs the signed image as a throwaway workload under the chosen ServiceAccount", () => {
  const pod = meshProbePod({
    name: "kore-probe-x",
    image,
    serviceAccount: "default",
    url,
  }) as {
    metadata: { name: string };
    spec: {
      restartPolicy: string;
      serviceAccountName: string;
      automountServiceAccountToken: boolean;
      containers: {
        image: string;
        command: string[];
        securityContext: Record<string, unknown>;
        resources: { requests: Record<string, string> };
      }[];
    };
  };

  assert.equal(pod.metadata.name, "kore-probe-x");
  assert.equal(pod.spec.restartPolicy, "Never");
  assert.equal(pod.spec.serviceAccountName, "default");
  assert.equal(pod.spec.automountServiceAccountToken, false);
  const [container] = pod.spec.containers;
  assert.equal(container!.image, image);
  assert.deepEqual(container!.command.slice(0, 2), ["node", "-e"]);
  assert.ok(container!.command[2]!.includes(url));
  assert.equal(container!.securityContext["runAsNonRoot"], true);
  assert.equal(container!.securityContext["readOnlyRootFilesystem"], true);
  assert.ok(container!.resources.requests["cpu"]);
});

test("the probe's result is its HTTP status or its connection error", () => {
  assert.deepEqual(parseProbeOutcome("noise\nSTATUS 403\n"), { status: 403 });
  assert.deepEqual(parseProbeOutcome("ERROR fetch failed\n"), {
    error: "fetch failed",
  });
  assert.throws(() => parseProbeOutcome("nothing useful"), /no result/);
});

test("a probe is applied with the configured context, awaited, read, and always deleted", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      return {
        stdout: args.includes("logs") ? "STATUS 403\n" : "",
        stderr: "",
        code: 0,
      };
    },
  };

  const outcome = await runMeshProbe(repository, runner, "reference", {
    image,
    serviceAccount: "default",
    url,
  });

  assert.deepEqual(outcome, { status: 403 });
  const verbs = calls.map(({ args }) =>
    args.find((arg) => ["apply", "wait", "logs", "delete"].includes(arg)),
  );
  assert.deepEqual(verbs, ["apply", "wait", "logs", "delete"]);
  for (const { command, args } of calls) {
    assert.equal(command, "kubectl");
    assert.deepEqual(args.slice(0, 4), [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      "reference",
    ]);
  }
});

test("the probe pod is deleted even when waiting for it fails", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      if (args.includes("wait")) {
        throw new CommandError("kubectl", [], {
          stdout: "",
          stderr: "timed out waiting for the condition",
          code: 1,
        });
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await assert.rejects(
    runMeshProbe(repository, runner, "reference", {
      image,
      serviceAccount: "default",
      url,
    }),
    /timed out/,
  );

  assert.ok(calls.at(-1)!.args.includes("delete"));
});
