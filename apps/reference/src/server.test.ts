import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

async function availablePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

test("frontend preserves an upstream authorization denial status", async () => {
  const forwardedRoles: string[] = [];
  const api = createServer((request, response) => {
    forwardedRoles.push(String(request.headers["x-kore-authenticated-role"]));
    if (request.headers["x-kore-authenticated-role"] === "developer") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ role: "developer" }));
    } else {
      response.writeHead(403);
      response.end();
    }
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const apiAddress = api.address();
  assert.ok(apiAddress && typeof apiAddress !== "string");

  const port = await availablePort();
  const app = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
    env: {
      ...process.env,
      APP_MODE: "frontend",
      API_URL: `http://127.0.0.1:${apiAddress.port}`,
      API_TOKEN: "test-token",
      PORT: String(port),
    },
    stdio: "ignore",
  });

  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/protected`, {
          headers: { "x-kore-role": "developer" },
        });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.ok(response, "frontend server should start");
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "upstream request denied" });
    assert.deepEqual(forwardedRoles, ["viewer"]);

    const authenticated = await fetch(`http://127.0.0.1:${port}/api/protected`, {
      headers: { authorization: "Bearer test-token", "x-kore-role": "viewer" },
    });
    assert.equal(authenticated.status, 200);
    assert.deepEqual(await authenticated.json(), { role: "developer" });
    assert.deepEqual(forwardedRoles, ["viewer", "developer"]);
  } finally {
    app.kill("SIGTERM");
    await new Promise<void>((resolve) => app.once("exit", () => resolve()));
    await new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
  }
});
