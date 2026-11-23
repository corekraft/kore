import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import { localPlatform } from "../local-platform-support.js";
import {
  document,
  renderWith,
  withFlagOff,
} from "./platform-backstage-support.js";

// Docs: docs/decisions/0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md

const platform = await localPlatform();

// The proxy exits when Keycloak's realm is not serving discovery yet, and
// Kubernetes then backs the restart off for minutes (issue 1788). With
// keycloakWait the pod's init container polls the realm until it answers, so
// neither container starts before Keycloak is ready.
const initContainers = (deployment: string): string =>
  deployment
    .split(/^ {6}initContainers:$/m)[1]
    ?.split(/^ {6}containers:$/m)[0] ?? "";

// The probe's script, read back from the rendered YAML's double-quoted scalar.
const probeScript = (rendered: string): string => {
  const line =
    rendered
      .split("\n")
      .find((l) => l.startsWith('            - "(async () => {')) ?? "";
  return JSON.parse(line.slice("            - ".length));
};

// Runs the probe as the init container does; resolves with its exit code and
// stderr, so a failed attempt's log line is visible to the test.
const runProbe = (script: string): Promise<{ code: number; stderr: string }> =>
  new Promise((resolve) => {
    execFile(process.execPath, ["-e", script], (error, _stdout, stderr) =>
      resolve({ code: error ? Number(error.code) : 0, stderr }),
    );
  });

test("with keycloakWait off the Deployment has no init container, so the portal renders as before", async () => {
  const rendered = await renderWith(await withFlagOff("local"));
  const deployment = document(rendered, "Deployment");
  assert.equal(deployment.includes("initContainers"), false);
});

test("with keycloakWait on an init container polls the realm's discovery until it answers, before either container starts", async () => {
  const rendered = await renderWith(await withFlagOff("local"), [
    "--set",
    "keycloakWait=true",
  ]);
  const init = initContainers(document(rendered, "Deployment"));
  const discovery = `https://keycloak.${platform.domain}/realms/platform/.well-known/openid-configuration`;
  const command = `            - "(async () => { const url = \\"${discovery}\\"; for (;;) { try { const res = await fetch(url); if (res.ok) process.exit(0); console.error('wait-for-keycloak: ' + url + ' answered ' + res.status + '; retrying'); } catch (e) { console.error('wait-for-keycloak: ' + url + ' not reachable (' + (e.cause?.code ?? e.cause?.message ?? e.message) + '); retrying'); } await new Promise((r) => setTimeout(r, 2000)); } })();"`;
  assert.ok(init.includes(command), init);
  assert.match(init, /^ {8}- name: wait-for-keycloak$/m);
  assert.match(init, /^ {12}- \/nodejs\/bin\/node$/m);
});

test("the init container runs the portal's pinned Backstage image as the numeric non-root uid and holds no credential", async () => {
  const repository = await loadRepository("local");
  const backstage = repository.approved.images.find(
    (i) => i.component === "kore-platform-backstage" && i.name === "backstage",
  );
  const rendered = await renderWith(await withFlagOff("local"), [
    "--set",
    "keycloakWait=true",
  ]);
  const init = initContainers(document(rendered, "Deployment"));
  assert.ok(init.includes(`image: "${backstage?.image}"`), init);
  assert.match(init, /^ {12}runAsUser: 65532$/m);
  assert.equal(init.includes("secretKeyRef"), false);
});

test("with the local CA the init container trusts the local CA bundle, as the Backstage container does", async () => {
  const rendered = await renderWith(await withFlagOff("local"), [
    "--set",
    "keycloakWait=true",
    "--set-string",
    "localCa.configMap=kore-local-ca",
  ]);
  const init = initContainers(document(rendered, "Deployment"));
  assert.match(init, /^ {14}value: \/etc\/kore\/local-ca\/bundle\.crt$/m);
  assert.match(init, /mountPath: \/etc\/kore\/local-ca$/m);
});

test("the init container logs each failed attempt, with its cause, before it retries, so kubectl logs names what it waits on", async () => {
  const rendered = await renderWith(await withFlagOff("local"), [
    "--set",
    "keycloakWait=true",
  ]);
  const discovery = `https://keycloak.${platform.domain}/realms/platform/.well-known/openid-configuration`;
  // Attempt 1 drops the connection (a thrown error), attempt 2 answers 503,
  // attempt 3 answers 200: two failures, each logged, then the probe exits 0.
  let attempts = 0;
  const server = createServer((request, response) => {
    attempts += 1;
    if (attempts === 1) {
      request.socket.destroy();
      return;
    }
    response.writeHead(attempts === 2 ? 503 : 200).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/realms/platform/.well-known/openid-configuration`;
  try {
    const script = probeScript(rendered).replaceAll(discovery, url);
    const result = await runProbe(script);
    assert.equal(result.code, 0);
    assert.equal(
      result.stderr,
      `wait-for-keycloak: ${url} not reachable (UND_ERR_SOCKET); retrying\n` +
        `wait-for-keycloak: ${url} answered 503; retrying\n`,
    );
  } finally {
    server.close();
  }
}, 15_000);
