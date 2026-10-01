import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { loadRepository } from "./config.js";
import { clusterDestroy } from "./cluster.js";
import { ProcessRunner } from "./runner.js";
import { stopLocalTunnel } from "./tunnel.js";

async function assertReferenceSmoke(repository: Awaited<ReturnType<typeof loadRepository>>, runner: ProcessRunner): Promise<void> {
  const { hostname, port } = repository.environment.gateway;
  const token = (await readFile(join(repository.root, ".kore/state/reference-api-token"), "utf8")).trim();
  const request = async (path: string, authorization?: string) => {
    const result = await runner.run("curl", [
      "--insecure", "--silent", "--show-error", "--write-out", "\n%{http_code}",
      "--resolve", `${hostname}:${port}:127.0.0.1`,
      ...(authorization ? ["--header", `Authorization: ${authorization}`] : []),
      `https://${hostname}:${port}${path}`,
    ], { capture: true, cwd: repository.root });
    const boundary = result.stdout.lastIndexOf("\n");
    assert.notEqual(boundary, -1, `curl returned no HTTP status for ${path}`);
    return { status: Number(result.stdout.slice(boundary + 1)), body: result.stdout.slice(0, boundary) };
  };

  for (const [path, field] of [["/livez", "live"], ["/readyz", "ready"]] as const) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path} should be healthy`);
    assert.equal(JSON.parse(response.body)[field], true);
  }

  const api = await request("/api");
  assert.equal(api.status, 200, "HTTPS API route should be reachable");
  assert.equal(JSON.parse(api.body).database, true, "API should have database connectivity through its Secret-backed configuration");

  const denied = await request("/api/protected", "Bearer invalid");
  assert.equal(denied.status, 403, "invalid credentials must be rejected by the protected route");
  const allowed = await request("/api/protected", `Bearer ${token}`);
  assert.equal(allowed.status, 200, "the generated Secret-backed API token should authorize the protected route");
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
      await runner.run("mise", ["install"], { capture: false, cwd: repository.root });
      await runner.run("mise", ["exec", "--", "npm", "--prefix", "tools/kore", "install"], { capture: false, cwd: repository.root });
      for (const args of [
        ["test"],
        ["run", "test:opa"],
      ]) {
        await runner.run("mise", ["exec", "--", "npm", "--prefix", "tools/kore", ...args], { capture: false, cwd: repository.root });
      }
      for (const args of [
        ["doctor", "--environment", "local"],
        ["validate", "--environment", "local"],
        ["cluster", "up", "--environment", "local"],
        ["platform", "bootstrap", "--environment", "local"],
        ["trust", "install", "--environment", "local"],
        ["platform", "up", "--environment", "local"],
        ["app", "up", "reference", "--environment", "local"],
        ["app", "status", "reference", "--environment", "local"],
      ]) {
        const result = await runner.run("mise", ["exec", "--", "npm", "--prefix", "tools/kore", "run", "kore", "--", ...args], { capture: false, cwd: repository.root });
        assert.equal(result.code, 0, `README command failed: kore ${args.join(" ")}`);
      }
      await assertReferenceSmoke(repository, runner);
    } finally {
      try {
        await stopLocalTunnel(repository, runner);
      } finally {
        await clusterDestroy(repository, runner, { yes: true, purgeData: true });
      }
    }
  },
);
