import { chromiumProgram } from "./chromium-program.js";

// Docs: docs/decisions/0180-backstage-reads-the-argo-cd-view-as-its-own-service-account-gated-by-the-operators-policy.md
// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

export interface BackstageDeliveryProgramOptions {
  /** Backstage's HTTPS host. */
  host: string;
  /** Keycloak's host, from keycloakHostname in the config domain. */
  keycloakHost: string;
  /** The gateway's HTTPS port. 443 is left out of the URLs. */
  port: number;
  username: string;
  password: string;
  /** The delivered Service's name, one DNS label; it is also its catalog entity's name. */
  service: string;
}

const line = (...rows: string[]): string => rows.join(String.fromCharCode(10));

function origin(host: string, port: number): string {
  return port === 443 ? "https://" + host : "https://" + host + ":" + port;
}

/**
 * The in-page read. It mints the Backstage identity every API call needs, calls
 * the catalog and the Kubernetes view with it, and returns only facts: statuses,
 * names, sync and health, and replica counts. The token never leaves the page.
 */
function readExpression(service: string): string {
  const name = JSON.stringify(service);
  return line(
    "(async () => {",
    "  const minted = await fetch('/api/auth/oidc/refresh?env=production', { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'include' });",
    "  const identity = minted.ok ? (await minted.json()).backstageIdentity : null;",
    "  const refs = identity && identity.identity ? identity.identity.ownershipEntityRefs : [];",
    "  const headers = { Authorization: 'Bearer ' + (identity ? identity.token : '') };",
    "  const entityReply = await fetch('/api/catalog/entities/by-name/component/default/' + " +
      name +
      ", { headers });",
    "  const entity = entityReply.ok ? await entityReply.json() : null;",
    "  let kube = null; let kubeStatus = null;",
    "  if (entity) { const reply = await fetch('/api/kubernetes/services/' + " +
      name +
      ", { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify({ entity }) }); kubeStatus = reply.status; kube = reply.ok ? await reply.json() : null; }",
    "  const items = kube && kube.items ? kube.items : [];",
    "  const resources = items.flatMap((item) => item.resources || []);",
    "  const applications = resources.filter((group) => group.type === 'customresources').flatMap((group) => group.resources || []).filter((object) => object.kind === 'Application').map((object) => ({ name: object.metadata && object.metadata.name, sync: object.status && object.status.sync && object.status.sync.status, health: object.status && object.status.health && object.status.health.status }));",
    "  const workloads = resources.filter((group) => group.type === 'deployments').flatMap((group) => group.resources || []).map((object) => ({ name: object.metadata.name, ready: (object.status && object.status.readyReplicas) || 0, wanted: (object.spec && object.spec.replicas) || 0 }));",
    "  return { mintedStatus: minted.status, groupHeld: refs.indexOf('group:default/platform-operators') >= 0, entityStatus: entityReply.status, kubeStatus, applications, workloads };",
    "})()",
  );
}

/**
 * The browser program of the Backstage delivery check (plan 15 Step 6 item 3).
 * It signs in through the proxy as the test user, then through Backstage's own
 * OIDC flow, and reads the delivered Service's catalog entity and its Kubernetes
 * view, which carries the Service's Argo CD Application (sync and health) and its
 * Deployments (ready and wanted replicas), read with Backstage's service account
 * (ADR 0180). Its output is four assertions with statuses, names and counts, and
 * no token, cookie or page body.
 */
export function backstageDeliveryProgram(
  options: BackstageDeliveryProgramOptions,
): string {
  const { host, keycloakHost } = options;
  const hostOrigin = origin(host, options.port);
  const flow = line(
    "const credentials = " +
      JSON.stringify({
        username: options.username,
        password: options.password,
      }) +
      ";",
    "const hostOrigin = " + JSON.stringify(hostOrigin) + ";",
    "const backstageHost = " + JSON.stringify(host) + ";",
    "const keycloakHost = " + JSON.stringify(keycloakHost) + ";",
    "const read = " + JSON.stringify(readExpression(options.service)) + ";",
    "const page = await chromium.newPage();",
    "await chromium.go(page, hostOrigin + '/oauth2/start?rd=/');",
    "await chromium.waitFor(page, 'location.hostname === ' + JSON.stringify(keycloakHost) + ' && !!document.querySelector(\"#kc-login\")', 'the Keycloak sign-in form');",
    "await chromium.type(page, '#username', credentials.username);",
    "await chromium.type(page, '#password', credentials.password);",
    "await chromium.evaluate(page, 'document.querySelector(\"#kc-login\").click(), true');",
    "await chromium.waitFor(page, 'location.hostname === ' + JSON.stringify(backstageHost) + ' && document.readyState === \"complete\"', 'Backstage after sign-in');",
    "await chromium.go(page, hostOrigin + '/api/auth/oidc/start?env=production&scope=' + encodeURIComponent('openid profile email') + '&origin=' + encodeURIComponent(hostOrigin) + '&flow=popup');",
    "await chromium.waitFor(page, 'location.pathname.indexOf(\"/api/auth/oidc/handler/frame\") === 0 && document.readyState === \"complete\"', 'the Backstage sign-in to finish');",
    "const facts = await chromium.evaluate(page, read);",
    "const application = facts.applications[0];",
    "const rolledOut = facts.workloads.length > 0 && facts.workloads.every((workload) => workload.wanted > 0 && workload.ready === workload.wanted);",
    "return { assertions: [",
    "  { name: 'backstage identity carries the operators group', ok: facts.mintedStatus === 200 && facts.groupHeld === true, mintedStatus: facts.mintedStatus },",
    "  { name: 'catalog lists the delivered service', ok: facts.entityStatus === 200, entityStatus: facts.entityStatus },",
    "  { name: \"kubernetes read returns the service's Argo CD Application with its sync and health\", ok: facts.kubeStatus === 200 && application !== undefined && typeof application.sync === 'string' && typeof application.health === 'string', kubeStatus: facts.kubeStatus, applications: facts.applications },",
    '  { name: "kubernetes read returns the service\'s workload with its rollout", ok: rolledOut, kubeStatus: facts.kubeStatus, workloads: facts.workloads },',
    "] };",
  );
  return chromiumProgram([host, keycloakHost], flow);
}
