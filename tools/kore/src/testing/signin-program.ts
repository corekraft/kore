import { chromiumProgram } from "./chromium-program.js";

// Docs: docs/decisions/0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md
// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

export interface SignInProgramOptions {
  /** The platform domain, such as kore.internal. */
  domain: string;
  /** The gateway's HTTPS port. 443 is left out of the URLs. */
  port: number;
  username: string;
  password: string;
}

const line = (...rows: string[]): string => rows.join(String.fromCharCode(10));

function origin(host: string, port: number): string {
  return port === 443 ? `https://${host}` : `https://${host}:${port}`;
}

/**
 * The browser program of the sign-in check. It signs in to Backstage through the
 * Keycloak form as the test user, asserts the signed-in call succeeds, then opens
 * Backstage with no sign-in and asserts the sign-in proxy refuses it, with a
 * 401 or a redirect to Keycloak. Its output is two assertions and no credential.
 */
export function signInProgram(options: SignInProgramOptions): string {
  const backstageHost = `backstage.${options.domain}`;
  const keycloakHost = `keycloak.${options.domain}`;
  const backstageUrl = `${origin(backstageHost, options.port)}/`;
  const keycloakOrigin = origin(keycloakHost, options.port);
  const flow = line(
    `const credentials = ${JSON.stringify({ username: options.username, password: options.password })};`,
    `const backstageUrl = ${JSON.stringify(backstageUrl)};`,
    `const backstageHost = ${JSON.stringify(backstageHost)};`,
    `const keycloakHost = ${JSON.stringify(keycloakHost)};`,
    `const keycloakOrigin = ${JSON.stringify(keycloakOrigin)};`,
    "const hostIs = (host) => 'location.hostname === ' + JSON.stringify(host);",
    "const signedIn = await chromium.newPage();",
    "await chromium.go(signedIn, backstageUrl);",
    "await chromium.waitFor(signedIn, hostIs(keycloakHost) + ' && !!document.querySelector(\"#kc-login\")', 'the Keycloak sign-in form');",
    "await chromium.type(signedIn, '#username', credentials.username);",
    "await chromium.type(signedIn, '#password', credentials.password);",
    "await chromium.evaluate(signedIn, 'document.querySelector(\"#kc-login\").click(), true');",
    "await chromium.waitFor(signedIn, hostIs(backstageHost) + ' && document.readyState === \"complete\"', 'Backstage after sign-in');",
    "const call = await chromium.evaluate(signedIn, 'fetch(location.href).then((reply) => ({ status: reply.status, host: new URL(reply.url).hostname }))');",
    "const anonymous = await chromium.newPage();",
    "await chromium.go(anonymous, backstageUrl);",
    "const answered = () => anonymous.documents.some((response) => response.url.indexOf(backstageUrl) === 0);",
    "for (let waited = 0; !answered() && waited < 120; waited++) { await new Promise((done) => setTimeout(done, 500)); }",
    "const first = anonymous.documents.find((response) => response.url.indexOf(backstageUrl) === 0);",
    "const headers = Object.fromEntries(Object.entries(first ? first.headers || {} : {}).map(([name, value]) => [name.toLowerCase(), value]));",
    "const location = String(headers.location || '');",
    "const redirected = first !== undefined && [301, 302, 303, 307, 308].includes(first.status) && (location.indexOf('/oauth2/') === 0 || location.indexOf(keycloakOrigin) === 0);",
    "const refused = first !== undefined && (first.status === 401 || redirected);",
    "return { assertions: [",
    "  { name: 'signed-in call succeeds', ok: call.status === 200 && call.host === backstageHost, status: call.status, host: call.host },",
    "  { name: 'request with no sign-in is refused', ok: refused, status: first ? first.status : null, location: location || null },",
    "] };",
  );
  return chromiumProgram([backstageHost, keycloakHost], flow);
}
