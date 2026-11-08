import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { loadRepository } from "../config/index.js";
import type { ProcessRunner } from "../runtime/index.js";

type Repository = Awaited<ReturnType<typeof loadRepository>>;
type HttpResult = { status: number; body: string };

async function assertStrictMtls(
  repository: Repository,
  runner: ProcessRunner,
): Promise<void> {
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
}

function gatewayRequester(repository: Repository, runner: ProcessRunner) {
  const { hostname, port } = repository.environment.gateway;
  return async (path: string, authorization?: string): Promise<HttpResult> => {
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
}

async function assertHealthEndpoints(
  request: (path: string) => Promise<HttpResult>,
): Promise<void> {
  for (const [path, field] of [
    ["/livez", "live"],
    ["/readyz", "ready"],
  ] as const) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path} should be healthy`);
    assert.equal(JSON.parse(response.body)[field], true);
  }
}

async function assertProtectedRoute(
  request: (path: string, authorization?: string) => Promise<HttpResult>,
  token: string,
): Promise<void> {
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

export async function assertReferenceSmoke(
  repository: Repository,
  runner: ProcessRunner,
): Promise<void> {
  const token = (
    await readFile(
      join(repository.root, ".kore/state/reference-api-token"),
      "utf8",
    )
  ).trim();
  await assertStrictMtls(repository, runner);
  const request = gatewayRequester(repository, runner);
  await assertHealthEndpoints(request);
  const api = await request("/api");
  assert.equal(api.status, 200, "HTTPS API route should be reachable");
  assert.equal(
    JSON.parse(api.body).database,
    true,
    "API should have database connectivity through its Secret-backed configuration",
  );
  await assertProtectedRoute(request, token);
}
