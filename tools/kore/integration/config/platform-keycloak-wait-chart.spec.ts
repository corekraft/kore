import assert from "node:assert/strict";
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
  const command = `            - "(async () => { for (;;) { try { if ((await fetch(\\"${discovery}\\")).ok) process.exit(0); } catch (e) {} await new Promise((r) => setTimeout(r, 2000)); } })();"`;
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
