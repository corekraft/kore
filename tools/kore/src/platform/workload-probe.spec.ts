import assert from "node:assert/strict";
import { test } from "vitest";
import { type Call } from "../testing/index.js";
import { loadRepository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { workloadVerdict } from "./workload-probe.js";

// Docs: docs/decisions/0072-constraint-promotion-procedure.md

const source = `10.96.0.50:5000/reference@sha256:${"c".repeat(64)}`;

test("a workload probe server dry-runs a Deployment naming the account, creating nothing", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const bodies: string[] = [];
  const runner: Runner = {
    async run(command, args, options) {
      calls.push({ command, args });
      bodies.push(options?.input ?? "");
      throw new CommandError("kubectl", [], {
        stdout: "",
        stderr:
          'admission webhook "validation.gatekeeper.sh" denied the request: the default ServiceAccount is forbidden',
        code: 1,
      });
    },
  };

  const verdict = await workloadVerdict(
    repository,
    runner,
    "reference",
    source,
    "default",
  );

  assert.equal(verdict.admitted, false);
  assert.match(verdict.detail, /default ServiceAccount is forbidden/);
  assert.ok(calls[0]?.args.includes("--dry-run=server"));
  const deployment = JSON.parse(bodies[0] ?? "{}") as {
    kind: string;
    spec: { template: { spec: { serviceAccountName: string } } };
  };
  assert.equal(deployment.kind, "Deployment");
  assert.equal(deployment.spec.template.spec.serviceAccountName, "default");
});
