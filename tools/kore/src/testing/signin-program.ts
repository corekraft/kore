import { chromiumProgram } from "./chromium-program.js";

// Docs: docs/decisions/0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md
// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

/** Where the browser starts, calls and makes its anonymous request, relative to the target's host. */
export interface SignInPaths {
  /** The sign-in's start, such as /oauth2/start?rd=/. */
  startPath: string;
  /** A route the signed-in browser fetches; it answers 200 for a signed-in session on the host. */
  signedInCallPath: string;
  /** The request made with no sign-in, which must be refused. */
  anonymousPath: string;
}

/** Backstage's paths: the oauth2-proxy start, Backstage's readiness route, and the root. */
export const backstageSignInPaths: SignInPaths = {
  startPath: "/oauth2/start?rd=/",
  signedInCallPath: "/.backstage/health/v1/readiness",
  anonymousPath: "/",
};

export interface SignInProgramOptions {
  /** The HTTPS host the sign-in lands on: Backstage's, or a golden-path Service's. */
  host: string;
  /** Keycloak's host, from keycloakHostname in the config domain. */
  keycloakHost: string;
  /** The gateway's HTTPS port. 443 is left out of the URLs. */
  port: number;
  username: string;
  password: string;
  /** Defaults to Backstage's paths, so the Backstage check's program is unchanged. */
  paths?: SignInPaths;
}

const line = (...rows: string[]): string => rows.join(String.fromCharCode(10));

function origin(host: string, port: number): string {
  return port === 443 ? `https://${host}` : `https://${host}:${port}`;
}

/**
 * The facts of the page a refused request lands on, read in the browser. Only
 * the title and four booleans leave the page; its body never does.
 */
const refusedPageFacts =
  "({ title: document.title, signInPage: !!document.body && /Sign in with Keycloak OIDC/.test(document.body.innerText), appRoot: document.querySelector('#root') !== null, appBundle: document.querySelector('script[src*=\"/static/\"]') !== null })";

/**
 * The browser program of the sign-in check. It starts the flow the way a person
 * does, at the target's start path, signs in through the Keycloak form as the
 * test user, and asserts the signed-in call succeeds. Then it makes a request
 * with no sign-in to the target's anonymous path and asserts the sign-in proxy
 * refuses it: a 401, a redirect to /oauth2/ or Keycloak, or a 403 that is the
 * proxy's sign-in page with no app content. Its output is two assertions and no
 * credential, and no page body. Backstage's signed-in call asks its readiness
 * route, since the sign-in lands on /, which the Kore backend answers with a 404.
 */
export function signInProgram(options: SignInProgramOptions): string {
  const { host, keycloakHost } = options;
  const paths = options.paths ?? backstageSignInPaths;
  const hostOrigin = origin(host, options.port);
  const anonymousUrl = `${hostOrigin}${paths.anonymousPath}`;
  const signInStartUrl = `${hostOrigin}${paths.startPath}`;
  const signedInCallUrl = `${hostOrigin}${paths.signedInCallPath}`;
  const keycloakOrigin = origin(keycloakHost, options.port);
  const flow = line(
    `const credentials = ${JSON.stringify({ username: options.username, password: options.password })};`,
    `const anonymousUrl = ${JSON.stringify(anonymousUrl)};`,
    `const signInStartUrl = ${JSON.stringify(signInStartUrl)};`,
    `const signedInCallUrl = ${JSON.stringify(signedInCallUrl)};`,
    `const hostOrigin = ${JSON.stringify(hostOrigin)};`,
    `const host = ${JSON.stringify(host)};`,
    `const keycloakHost = ${JSON.stringify(keycloakHost)};`,
    `const keycloakOrigin = ${JSON.stringify(keycloakOrigin)};`,
    `const refusedPageFacts = ${JSON.stringify(refusedPageFacts)};`,
    "const hostIs = (name) => 'location.hostname === ' + JSON.stringify(name);",
    "const signedIn = await chromium.newPage();",
    "await chromium.go(signedIn, signInStartUrl);",
    "await chromium.waitFor(signedIn, hostIs(keycloakHost) + ' && !!document.querySelector(\"#kc-login\")', 'the Keycloak sign-in form');",
    "await chromium.type(signedIn, '#username', credentials.username);",
    "await chromium.type(signedIn, '#password', credentials.password);",
    "await chromium.evaluate(signedIn, 'document.querySelector(\"#kc-login\").click(), true');",
    "await chromium.waitFor(signedIn, hostIs(host) + ' && document.readyState === \"complete\"', 'the target after sign-in');",
    "const call = await chromium.evaluate(signedIn, 'fetch(' + JSON.stringify(signedInCallUrl) + ').then((reply) => ({ status: reply.status, host: new URL(reply.url).hostname }))');",
    "const anonymous = await chromium.newPage();",
    "await chromium.go(anonymous, anonymousUrl);",
    "const answered = () => anonymous.documents.some((response) => response.url.indexOf(anonymousUrl) === 0);",
    "for (let waited = 0; !answered() && waited < 120; waited++) { await new Promise((done) => setTimeout(done, 500)); }",
    "const first = anonymous.documents.find((response) => response.url.indexOf(anonymousUrl) === 0);",
    "const headers = Object.fromEntries(Object.entries(first ? first.headers || {} : {}).map(([name, value]) => [name.toLowerCase(), value]));",
    "const location = String(headers.location || '');",
    "const redirected = first !== undefined && [301, 302, 303, 307, 308].includes(first.status) && (location.indexOf('/oauth2/') === 0 || location.indexOf(keycloakOrigin) === 0 || location.indexOf(hostOrigin + '/oauth2/') === 0);",
    "let page = null;",
    "if (first !== undefined && first.status === 403) {",
    "  await chromium.waitFor(anonymous, 'document.readyState === \"complete\"', 'the refused page to finish loading');",
    "  page = await chromium.evaluate(anonymous, refusedPageFacts);",
    "}",
    "const signInPage = page !== null && page.title === 'Sign In' && page.signInPage === true && page.appRoot === false && page.appBundle === false;",
    "const refused = first !== undefined && (first.status === 401 || redirected || (first.status === 403 && signInPage));",
    "return { assertions: [",
    "  { name: 'signed-in call succeeds', ok: call.status === 200 && call.host === host, status: call.status, host: call.host },",
    "  { name: 'request with no sign-in is refused', ok: refused, status: first ? first.status : null, location: location || null, title: page ? page.title : null },",
    "] };",
  );
  return chromiumProgram([host, keycloakHost], flow);
}
