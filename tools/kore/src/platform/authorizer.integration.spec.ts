import assert from "node:assert/strict";
import test from "node:test";
import {
  decisionLogArguments,
  fakeCredential,
  live,
  opaNamespace,
  read,
  setup,
  viaGateway,
} from "./identity-live.js";

// Docs: docs/decisions/0059-identity-policy-evidence.md
// Live and opt-in; see identity-live.ts. Run: npm run test:integration:identity

test(
  "OPA's decision input carries the authenticated source and destination principals (the waypoint forwards them in x-forwarded-client-cert; ADR 0066)",
  live,
  async () => {
    const { repository, runner } = await setup();
    const status = await viaGateway(
      repository,
      runner,
      "/api/protected",
      `Bearer ${fakeCredential}`,
    );
    // A request with no valid principal or role must be denied, never allowed.
    assert.equal(status, 403, "the protected request must be denied by OPA");
    const logs = await read(
      repository,
      runner,
      ...decisionLogArguments(opaNamespace(repository)),
    );
    const decisions = logs
      .split("\n")
      .filter((line) => line.startsWith("{") && line.includes('"input"'))
      .map(
        (line) =>
          JSON.parse(line) as {
            input?: {
              attributes?: {
                request?: { http?: { headers?: Record<string, string> } };
              };
            };
          },
      );
    assert.ok(
      decisions.length > 0,
      "the protected request produced no OPA decision",
    );
    // Envoy's ext_authz request has no TLS peer identity behind an ambient waypoint;
    // the waypoint synthesizes XFCC (By = waypoint, URI = authenticated caller).
    const xfcc = String(
      decisions[decisions.length - 1]?.input?.attributes?.request?.http
        ?.headers?.["x-forwarded-client-cert"],
    );
    assert.match(xfcc, /(?:^|;)URI=spiffe:\/\/[^;]+\/ns\/.+\/sa\/.+/);
    assert.match(xfcc, /(?:^|;)By=spiffe:\/\/[^;]+\/ns\/.+\/sa\/.+/);
  },
);

test(
  "a denial is observable in OPA's decision log and never contains the credential presented",
  live,
  async () => {
    const { repository, runner } = await setup();
    const status = await viaGateway(
      repository,
      runner,
      "/api/protected",
      `Bearer ${fakeCredential}`,
    );
    assert.equal(status, 403);
    const logs = await read(
      repository,
      runner,
      ...decisionLogArguments(opaNamespace(repository)),
    );
    assert.match(logs, /"result":false/, "the denial must be logged");
    assert.doesNotMatch(
      logs,
      new RegExp(fakeCredential),
      "credentials must be masked",
    );
  },
);

test(
  "the protected route fails closed while the authorizer is unavailable, and the authorizer is restored",
  live,
  async () => {
    const { repository, runner } = await setup();
    const scope = ["--namespace", opaNamespace(repository)];
    const replicas = (
      await read(
        repository,
        runner,
        ...scope,
        "get",
        "deployment/opa-authorizer",
        "--output=jsonpath={.spec.replicas}",
      )
    ).trim();
    try {
      await read(
        repository,
        runner,
        ...scope,
        "scale",
        "deployment/opa-authorizer",
        "--replicas=0",
      );
      await read(
        repository,
        runner,
        ...scope,
        "wait",
        "--for=delete",
        "pod",
        "--selector=app.kubernetes.io/name=opa-authorizer",
        "--timeout=120s",
      );
      const status = await viaGateway(
        repository,
        runner,
        "/api/protected",
        `Bearer ${fakeCredential}`,
      );
      assert.notEqual(
        status,
        200,
        "an unavailable authorizer must never allow the request",
      );
      assert.ok(
        status === 403 || status >= 500,
        `expected a denial, got ${status}`,
      );
    } finally {
      await read(
        repository,
        runner,
        ...scope,
        "scale",
        "deployment/opa-authorizer",
        `--replicas=${replicas}`,
      );
      await read(
        repository,
        runner,
        ...scope,
        "rollout",
        "status",
        "deployment/opa-authorizer",
        "--timeout=180s",
      );
    }
  },
);

test(
  "the authorizer pods run the bundle the chart carries, so none serves a stale bundle",
  live,
  async () => {
    const { repository, runner } = await setup();
    const scope = ["--namespace", opaNamespace(repository)];
    const wanted = (
      await read(
        repository,
        runner,
        ...scope,
        "get",
        "deployment/opa-authorizer",
        "--output=jsonpath={.spec.template.metadata.annotations.checksum/bundle}",
      )
    ).trim();
    assert.match(wanted, /^[a-f0-9]{64}$/);
    const running = (
      await read(
        repository,
        runner,
        ...scope,
        "get",
        "pods",
        "--selector=app.kubernetes.io/name=opa-authorizer",
        '--output=jsonpath={range .items[*]}{.metadata.annotations.checksum/bundle}{"\\n"}{end}',
      )
    )
      .split("\n")
      .filter(Boolean);
    assert.ok(running.length > 0);
    for (const checksum of running) {
      assert.equal(checksum, wanted, "a pod runs a stale bundle");
    }
  },
);
