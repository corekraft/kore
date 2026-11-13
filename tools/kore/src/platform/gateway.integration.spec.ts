import assert from "node:assert/strict";
import test from "node:test";
import { loadRepository } from "../config/index.js";
import {
  listHostProcesses,
  ProcessRunner,
  integrationEnvironment,
} from "../runtime/index.js";
import {
  Cluster,
  conditionHolds,
  eventually,
  helmRevisions,
  httpsGet,
  mkcertRoot,
  withProofNamespace,
} from "./gateway-cluster-support.js";
import {
  certificateProblem,
  proofManifests,
  routeProblem,
  secretKeys,
  tunnelProcessProblem,
} from "./gateway-proof.js";
import type { ProofOptions } from "./gateway-proof.js";
import { platformStatus, platformUp } from "./index.js";

// Docs: docs/decisions/0013-local-tls-before-gateway.md
// Live: needs a running k3d cluster after `kore local up`; the k3d load balancer
// answers on the Gateway port with no tunnel process. Creates only a throwaway
// namespace, removed in `finally`;
// no secret value is ever read or printed. Run with KORE_RUN_INTEGRATION=1
// (`npm run test:integration:gateway`).

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_INTEGRATION !== "1"
      ? "set KORE_RUN_INTEGRATION=1 to opt into a live platform"
      : false,
  timeout: 15 * 60 * 1000,
};

const getRoute = (cluster: Cluster, options: ProofOptions) =>
  cluster.json(["--namespace", options.namespace, "get", "httproute/echo"]);

const routeReady = (cluster: Cluster, options: ProofOptions) =>
  eventually(
    "the HTTPRoute",
    () => getRoute(cluster, options),
    (route) => routeProblem(route),
  );

// The endpoint must answer through the load balancer alone: a tunnel left
// running would answer the same request and hide a broken port mapping.
const httpsLive = (cluster: Cluster, options: ProofOptions, root: string) =>
  eventually(
    "the HTTPS endpoint through the load balancer, with no tunnel process",
    async () => {
      const tunnel = tunnelProcessProblem(
        await listHostProcesses(),
        cluster.repository.environment.gateway.port,
      );
      return tunnel
        ? { status: 0, body: tunnel }
        : httpsGet(cluster, options, root, "/livez");
    },
    (result) => {
      if (result.status === 200) {
        return undefined;
      }
      return result.status === 0 ? result.body : `status ${result.status}`;
    },
  );

async function gatewayReady(cluster: Cluster): Promise<void> {
  const { gateway } = cluster.repository.environment;
  await eventually(
    "the Gateway",
    () =>
      cluster.json([
        "--namespace",
        gateway.namespace,
        "get",
        `gateway/${gateway.name}`,
      ]),
    (resource) =>
      conditionHolds(resource, "Accepted") ??
      conditionHolds(resource, "Programmed"),
  );
}

test(
  "a test HTTPRoute gets a trusted HTTPS endpoint with a ready Gateway, a renewable Certificate, and a materialized Secret schema",
  live,
  async () => {
    await withProofNamespace(async (cluster, options) => {
      await gatewayReady(cluster);
      await routeReady(cluster, options);
      const certificate = await cluster.json([
        "--namespace",
        options.gateway.namespace,
        "get",
        "certificate/kore-local",
      ]);
      assert.equal(
        certificateProblem(certificate, new Date()),
        undefined,
        "the Certificate must be Ready with renewalTime before notAfter",
      );
      const response = await httpsLive(
        cluster,
        options,
        await mkcertRoot(cluster.runner),
      );
      assert.equal(JSON.parse(response.body).live, true);

      // Materialization: assert the target Secret's KEYS only, never values.
      const secret = await eventually(
        "the ExternalSecret target",
        () =>
          cluster.json([
            "--namespace",
            options.namespace,
            "get",
            "secret/proof-target",
          ]),
        (found) =>
          secretKeys(found).includes("PROOF_KEY") ? undefined : "key missing",
      );
      assert.deepEqual(secretKeys(secret), ["PROOF_KEY"]);
    });
  },
);

async function injectBackendFailure(
  cluster: Cluster,
  options: ProofOptions,
): Promise<void> {
  await cluster.kubectl([
    "--namespace",
    options.namespace,
    "delete",
    "service/echo",
  ]);
  const broken = await eventually(
    "the route to report the missing backend",
    () => getRoute(cluster, options),
    (route) =>
      /ResolvedRefs/.test(routeProblem(route) ?? "")
        ? undefined
        : "route still resolves",
  );
  assert.match(routeProblem(broken) ?? "", /ResolvedRefs/);
  // The next reconcile (a re-apply of the desired state) recovers it.
  await cluster.apply(proofManifests(options));
  await routeReady(cluster, options);
}

async function injectTlsFailure(
  cluster: Cluster,
  options: ProofOptions,
): Promise<void> {
  const { namespace } = options.gateway;
  await cluster.kubectl([
    "--namespace",
    namespace,
    "delete",
    "secret/kore-local-tls",
  ]);
  await eventually(
    "the TLS Secret to be re-issued",
    () =>
      cluster.json(["--namespace", namespace, "get", "secret/kore-local-tls"]),
    (secret) =>
      ["tls.crt", "tls.key"].every((key) => secretKeys(secret).includes(key))
        ? undefined
        : "tls.crt or tls.key missing",
  );
  await eventually(
    "kore status to report the TLS release ready",
    () =>
      platformStatus(cluster.repository, cluster.runner, ["kore-local-tls"]),
    (rows) =>
      rows.every((row) => row.status === "ready")
        ? undefined
        : rows.map((row) => `${row.name}: ${row.detail}`).join("; "),
  );
  await httpsLive(cluster, options, await mkcertRoot(cluster.runner));
}

test(
  "a removed backend is named by the route's conditions and a re-apply recovers; a deleted TLS Secret is re-issued and the platform reports ready",
  live,
  async () => {
    await withProofNamespace(async (cluster, options) => {
      await routeReady(cluster, options);
      await injectBackendFailure(cluster, options);
      await injectTlsFailure(cluster, options);
    });
  },
);

test(
  "repeating platform creation on a converged cluster changes no Helm release",
  live,
  async () => {
    const repository = await loadRepository(integrationEnvironment());
    const cluster = new Cluster(repository, new ProcessRunner());
    const before = await helmRevisions(cluster);
    await platformUp(repository, cluster.runner);
    assert.deepEqual(
      await helmRevisions(cluster),
      before,
      "a second platform up must not bump any release revision",
    );
  },
);
