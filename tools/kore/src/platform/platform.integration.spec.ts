import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { loadRepository } from "../config/index.js";
import { clusterDestroy } from "../cluster/index.js";
import { ProcessRunner } from "../runtime/index.js";
import { stopLocalTunnel } from "../tunnel/index.js";

async function assertReferenceSmoke(
  repository: Awaited<ReturnType<typeof loadRepository>>,
  runner: ProcessRunner,
): Promise<void> {
  const { hostname, port } = repository.environment.gateway;
  const token = (
    await readFile(
      join(repository.root, ".kore/state/reference-api-token"),
      "utf8",
    )
  ).trim();
  const mtls = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      "reference",
      "get",
      "peerauthentication",
      "strict",
      "--output=jsonpath={.spec.mtls.mode}",
    ],
    { capture: true, cwd: repository.root },
  );
  assert.equal(
    mtls.stdout.trim(),
    "STRICT",
    "the API namespace must require Istio mTLS",
  );
  const request = async (path: string, authorization?: string) => {
    const result = await runner.run(
      "curl",
      [
        "--insecure",
        "--silent",
        "--show-error",
        "--write-out",
        "\n%{http_code}",
        "--resolve",
        `${hostname}:${port}:127.0.0.1`,
        ...(authorization
          ? ["--header", `Authorization: ${authorization}`]
          : []),
        `https://${hostname}:${port}${path}`,
      ],
      { capture: true, cwd: repository.root },
    );
    const boundary = result.stdout.lastIndexOf("\n");
    assert.notEqual(boundary, -1, `curl returned no HTTP status for ${path}`);
    return {
      status: Number(result.stdout.slice(boundary + 1)),
      body: result.stdout.slice(0, boundary),
    };
  };

  for (const [path, field] of [
    ["/livez", "live"],
    ["/readyz", "ready"],
  ] as const) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path} should be healthy`);
    assert.equal(JSON.parse(response.body)[field], true);
  }

  const api = await request("/api");
  assert.equal(api.status, 200, "HTTPS API route should be reachable");
  assert.equal(
    JSON.parse(api.body).database,
    true,
    "API should have database connectivity through its Secret-backed configuration",
  );

  const denied = await request("/api/protected", "Bearer invalid");
  assert.equal(
    denied.status,
    403,
    "invalid credentials must be rejected by the protected route",
  );
  const allowed = await request("/api/protected", `Bearer ${token}`);
  assert.equal(
    allowed.status,
    200,
    "the generated Secret-backed API token should authorize the protected route",
  );
}

async function assertDatabasePersistence(
  repository: Awaited<ReturnType<typeof loadRepository>>,
  runner: ProcessRunner,
): Promise<void> {
  const kubectl = [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    "reference",
  ];
  const primary = await runner.run(
    "kubectl",
    [
      ...kubectl,
      "get",
      "pods",
      "--selector=cnpg.io/cluster=reference-db,role=primary",
      "--output=jsonpath={.items[0].metadata.name}{'\\n'}{.items[0].metadata.uid}",
    ],
    { capture: true, cwd: repository.root },
  );
  const [pod = "", uid = ""] = primary.stdout.trim().split(/\r?\n/);
  assert.notEqual(pod, "", "the reference database must have a primary pod");
  assert.notEqual(
    uid,
    "",
    "the reference database primary must have a Pod UID",
  );
  const credential = await runner.run(
    "kubectl",
    [
      ...kubectl,
      "get",
      "secret",
      "reference-db-app",
      "--output=jsonpath={.data.password}",
    ],
    { capture: true, cwd: repository.root },
  );
  const password = Buffer.from(credential.stdout.trim(), "base64").toString(
    "utf8",
  );
  assert.notEqual(
    password,
    "",
    "the database connection Secret must contain a password",
  );

  const psql = async (targetPod: string, sql: string) =>
    runner.run(
      "kubectl",
      [
        ...kubectl,
        "exec",
        targetPod,
        "--",
        "env",
        `PGPASSWORD=${password}`,
        "psql",
        "--host=127.0.0.1",
        "--username=app",
        "--dbname=app",
        "--tuples-only",
        "--no-align",
        `--command=${sql}`,
      ],
      { capture: true, cwd: repository.root },
    );
  await psql(
    pod,
    "CREATE TABLE IF NOT EXISTS kore_smoke_persistence (id integer PRIMARY KEY, marker text NOT NULL)",
  );
  await psql(
    pod,
    "INSERT INTO kore_smoke_persistence (id, marker) VALUES (1, 'survives-pod-restart') ON CONFLICT (id) DO UPDATE SET marker = EXCLUDED.marker",
  );

  await runner.run("kubectl", [...kubectl, "delete", "pod", pod], {
    capture: true,
    cwd: repository.root,
  });
  let replacementPod = "";
  for (let attempt = 0; attempt < 60; attempt++) {
    const replacement = await runner.run(
      "kubectl",
      [
        ...kubectl,
        "get",
        "pods",
        "--selector=cnpg.io/cluster=reference-db,role=primary",
        "--output=jsonpath={.items[0].metadata.name}{'\\n'}{.items[0].metadata.uid}",
      ],
      { capture: true, cwd: repository.root },
    );
    const [candidate = "", replacementUid = ""] = replacement.stdout
      .trim()
      .split(/\r?\n/);
    if (candidate && replacementUid && replacementUid !== uid) {
      replacementPod = candidate;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  assert.notEqual(
    replacementPod,
    "",
    "the database must be recreated with a new Pod UID within five minutes",
  );
  await runner.run(
    "kubectl",
    [
      ...kubectl,
      "wait",
      "--for=condition=Ready",
      `pod/${replacementPod}`,
      "--timeout=5m",
    ],
    { capture: true, cwd: repository.root },
  );
  const persisted = await psql(
    replacementPod,
    "SELECT marker FROM kore_smoke_persistence WHERE id = 1",
  );
  assert.equal(
    persisted.stdout.trim(),
    "survives-pod-restart",
    "database data must survive PostgreSQL pod replacement",
  );
}

test(
  "README local quick start converges and cleans up",
  {
    concurrency: false,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1"
        ? "set KORE_RUN_INTEGRATION=1 to opt into a live platform"
        : false,
    timeout: 45 * 60 * 1000,
  },
  async () => {
    const repository = await loadRepository("local");
    const runner = new ProcessRunner();
    try {
      await runner.run("mise", ["install"], {
        capture: false,
        cwd: repository.root,
      });
      await runner.run(
        "mise",
        ["exec", "--", "npm", "--prefix", "tools/kore", "install"],
        { capture: false, cwd: repository.root },
      );
      for (const args of [["test"], ["run", "test:opa"]]) {
        await runner.run(
          "mise",
          ["exec", "--", "npm", "--prefix", "tools/kore", ...args],
          { capture: false, cwd: repository.root },
        );
      }
      for (const args of [
        ["doctor", "--environment", "local"],
        ["validate", "--environment", "local"],
        ["local", "up", "--environment", "local"],
        ["app", "status", "reference", "--environment", "local"],
      ]) {
        const result = await runner.run(
          "mise",
          [
            "exec",
            "--",
            "npm",
            "--prefix",
            "tools/kore",
            "run",
            "kore",
            "--",
            ...args,
          ],
          { capture: false, cwd: repository.root },
        );
        assert.equal(
          result.code,
          0,
          `README command failed: kore ${args.join(" ")}`,
        );
      }
      await assertReferenceSmoke(repository, runner);
      await assertDatabasePersistence(repository, runner);
    } finally {
      try {
        await stopLocalTunnel(repository, runner);
      } finally {
        await clusterDestroy(repository, runner, {
          yes: true,
          purgeData: true,
        });
      }
    }
  },
);
