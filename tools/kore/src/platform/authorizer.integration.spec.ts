import assert from "node:assert/strict";
import test from "node:test";
import {
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
  "OPA's decision input carries the authenticated source and destination principals (ADR 0014 records that Istio 1.30 does not send them)",
  live,
  async () => {
    const { repository, runner } = await setup();
    await viaGateway(
      repository,
      runner,
      "/api/protected",
      `Bearer ${fakeCredential}`,
    );
    const logs = await read(
      repository,
      runner,
      "--namespace",
      opaNamespace(repository),
      "logs",
      "deployment/opa-authorizer",
      "--since=2m",
    );
    const decisions = logs
      .split("\n")
      .filter((line) => line.startsWith("{") && line.includes('"input"'))
      .map(
        (line) =>
          JSON.parse(line) as {
            input?: {
              attributes?: {
                source?: { principal?: string };
                destination?: { principal?: string };
              };
            };
          },
      );
    assert.ok(
      decisions.length > 0,
      "the protected request produced no OPA decision",
    );
    const last = decisions[decisions.length - 1]?.input?.attributes;
    assert.match(String(last?.source?.principal), /\/ns\/.+\/sa\/.+/);
    assert.match(String(last?.destination?.principal), /\/ns\/.+\/sa\/.+/);
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
      "--namespace",
      opaNamespace(repository),
      "logs",
      "deployment/opa-authorizer",
      "--since=2m",
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
