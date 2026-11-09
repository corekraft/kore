import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { auditEvidence } from "../config/index.js";
import { admissionVerdict, deployedImage } from "./admission-probe.js";
import {
  constraints,
  live,
  namespace,
  read,
  setup,
  viaGateway,
} from "./identity-live.js";

// Docs: docs/decisions/0059-identity-policy-evidence.md
// Live and opt-in; see identity-live.ts. Run: npm run test:integration:identity

test(
  "every Gatekeeper constraint audits the live platform with zero violations, the evidence a promotion records",
  live,
  async () => {
    const { repository, runner } = await setup();
    const evidence: Record<string, unknown> = {};
    for (const { kind, name } of await constraints(repository)) {
      const json = JSON.parse(
        await read(
          repository,
          runner,
          "get",
          `${kind.toLowerCase()}.constraints.gatekeeper.sh`,
          name,
          "--output=json",
        ),
      ) as Record<string, unknown>;
      const observed = auditEvidence(json);
      assert.ok(observed, `${name} has not been audited yet; wait a cycle`);
      evidence[name] = observed;
      assert.equal(
        observed.totalViolations,
        0,
        `${name} reports ${observed.totalViolations} violations; the platform, including its controllers, must comply before promotion`,
      );
    }
    // Copy these into infra/policies/gatekeeper/promotions/<constraint>.json.
    console.log(JSON.stringify({ environment: "local", evidence }, null, 2));
  },
);

test(
  "a workload using the default ServiceAccount is rejected once its constraint enforces",
  live,
  async (t) => {
    const { repository, runner } = await setup();
    const action = (
      await read(
        repository,
        runner,
        "get",
        "koreworkloadidentity.constraints.gatekeeper.sh",
        "kore-workload-identity",
        "--output=jsonpath={.spec.enforcementAction}",
      )
    ).trim();
    if (action !== "deny") {
      t.skip(
        `kore-workload-identity is ${action}; it rejects only after promotion`,
      );
      return;
    }
    const image = await deployedImage(repository, runner, namespace);
    const verdict = await admissionVerdict(
      repository,
      runner,
      namespace,
      image,
      { serviceAccountName: "default" },
    );
    assert.equal(
      verdict.admitted,
      false,
      "the default ServiceAccount must be rejected",
    );
    assert.match(verdict.detail, /default ServiceAccount is forbidden/);
  },
);

test(
  "ztunnel authenticates the reference workloads with the documented SPIFFE principals",
  live,
  async () => {
    const { repository, runner } = await setup();
    await viaGateway(repository, runner, "/api");
    const logs = await read(
      repository,
      runner,
      "--namespace",
      "istio-system",
      "logs",
      "daemonset/ztunnel",
      "--since=5m",
      "--all-containers",
    );
    const principal = new RegExp(
      `spiffe://cluster\\.local/ns/${namespace}/sa/reference-(frontend|api|api-waypoint)`,
    );
    assert.match(
      logs,
      principal,
      "ztunnel access logs must show a SPIFFE identity of the form spiffe://<trust-domain>/ns/<namespace>/sa/<account>",
    );
  },
);

test(
  "every application namespace is enrolled in image admission and the ambient mesh",
  live,
  async () => {
    const { repository, runner } = await setup();
    const applications = (
      await readdir(join(repository.root, "apps"), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    assert.ok(
      applications.length > 0,
      "the repository declares no application",
    );
    for (const application of applications) {
      const labels = JSON.parse(
        await read(
          repository,
          runner,
          "get",
          "namespace",
          application,
          "--output=jsonpath={.metadata.labels}",
        ),
      ) as Record<string, string>;
      assert.equal(
        labels["policy.sigstore.dev/include"],
        "true",
        `${application} is not enrolled in image admission`,
      );
      assert.equal(
        labels["istio.io/dataplane-mode"],
        "ambient",
        `${application} is not in the ambient mesh`,
      );
    }
  },
);
