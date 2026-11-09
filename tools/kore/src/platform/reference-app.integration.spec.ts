import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedCluster } from "../cluster/index.js";
import { loadRepository } from "../config/index.js";
import { findRoot } from "../config/config.js";
import { ProcessRunner } from "../runtime/index.js";
import { deployedImage } from "./admission-probe.js";
import { runMeshProbe } from "./reference-probe.js";
import { assertReferenceSmoke } from "./platform.reference-smoke.integration.spec.js";

// Docs: docs/decisions/0007-workload-identity-and-layered-authorization.md
// Live and opt-in (`npm run test:integration:reference`): needs a running
// local profile with the `reference` application up (`kore local up`, then
// `kore app up reference --environment local`). It reads cluster state and
// runs one throwaway probe pod from the application's own signed image, which
// it deletes. It never reads a Secret value.

const namespace = "reference";
const expectedOtlpEndpoint = "http://otel-collector.observability.svc:4318";

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_INTEGRATION !== "1"
      ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
      : false,
  timeout: 10 * 60 * 1000,
};

async function context() {
  const repository = await loadRepository("local", await findRoot());
  const runner = new ProcessRunner();
  await assertExpectedCluster(repository, runner);
  const kubectl = async (...args: string[]): Promise<string> =>
    (
      await runner.run(
        "kubectl",
        [
          "--context",
          repository.environment.kubeContext,
          "--namespace",
          namespace,
          ...args,
        ],
        { capture: true },
      )
    ).stdout.trim();
  return { repository, runner, kubectl };
}

const ready = (kind: string, name: string) =>
  `get ${kind} ${name} --output=jsonpath={.status.conditions[?(@.type=="Ready")].status}`.split(
    " ",
  );

test(
  "smoke: HTTPS, health, database, mTLS, and the OPA-protected route work through the gateway",
  live,
  async () => {
    const { repository, runner } = await context();
    await assertReferenceSmoke(repository, runner);
  },
);

test(
  "smoke: the database claim and the external Secret are ready, and credentials reach workloads only by secretKeyRef",
  live,
  async () => {
    const { kubectl } = await context();

    assert.equal(
      await kubectl(
        ...ready("postgresqlinstances.platform.kore.dev", "reference-db"),
      ),
      "True",
      "the PostgreSQL claim must be ready",
    );
    assert.equal(
      await kubectl(...ready("externalsecret", "reference-app")),
      "True",
      "the ExternalSecret must have synced the API token Secret",
    );
    for (const workload of ["reference-api", "reference-frontend"]) {
      const env = JSON.parse(
        await kubectl(
          "get",
          "deployment",
          workload,
          "--output=jsonpath={.spec.template.spec.containers[0].env}",
        ),
      ) as { name: string; value?: string; valueFrom?: object }[];
      for (const variable of env.filter(({ name }) =>
        /PASSWORD|TOKEN/.test(name),
      )) {
        assert.ok(
          variable.valueFrom && !("value" in variable),
          `${workload} ${variable.name} must come from a Secret reference, never a literal`,
        );
      }
    }
  },
);

test(
  "smoke: workloads are captured by the ambient mesh and send telemetry to the documented OTLP endpoint",
  live,
  async () => {
    const { kubectl } = await context();

    const redirections = (
      await kubectl(
        "get",
        "pods",
        "--selector=app.kubernetes.io/part-of=reference",
        '--output=jsonpath={range .items[*]}{.metadata.annotations.ambient\\.istio\\.io/redirection}{"\\n"}{end}',
      )
    )
      .split("\n")
      .filter((line) => line !== "");
    assert.ok(redirections.length >= 2, "both workloads must be running");
    assert.ok(redirections.every((value) => value === "enabled"));

    for (const workload of ["reference-api", "reference-frontend"]) {
      const endpoint = await kubectl(
        "get",
        "deployment",
        workload,
        '--output=jsonpath={.spec.template.spec.containers[0].env[?(@.name=="OTEL_EXPORTER_OTLP_ENDPOINT")].value}',
      );
      assert.equal(endpoint, expectedOtlpEndpoint);
    }
  },
);

test(
  "negative: a workload on an undeclared ServiceAccount is refused by the mesh, not only by the application",
  live,
  async () => {
    const { repository, runner } = await context();
    const image = await deployedImage(repository, runner, namespace);

    for (const path of ["/api", "/api/protected"]) {
      const outcome = await runMeshProbe(repository, runner, namespace, {
        image,
        serviceAccount: "default",
        url: `http://reference-api:8080${path}`,
      });
      assert.equal(
        outcome.status,
        403,
        `the default ServiceAccount must not reach ${path}: ${JSON.stringify(outcome)}`,
      );
    }
  },
);
