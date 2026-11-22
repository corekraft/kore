import { chromiumProgram } from "./chromium-program.js";
import type { SignInPaths } from "./signin-program.js";

// Docs: infra/plans/15-next-horizon.md (Step 7, the browser token test)
// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

export interface SignInTokenProgramOptions {
  /** The golden-path Service's HTTPS host. */
  host: string;
  /** Keycloak's host, from keycloakHostname in the config domain. */
  keycloakHost: string;
  /** The gateway's HTTPS port. 443 is left out of the URLs. */
  port: number;
  username: string;
  password: string;
  /** The Service's own paths: its sign-in start and its signed-in call. */
  paths: SignInPaths;
}

/**
 * The token patterns the browser looks for. A token is a JWT (three base64url
 * segments, the first starting eyJ), or sits under a token-named key, cookie or
 * URL parameter. Both are JSON-encoded into the program, so the patterns are
 * written once, here.
 */
export const tokenPatterns = {
  shape: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.source,
  name: /(access|refresh|id)[_-]?token/.source,
  parameter: /[?&#](access_token|refresh_token|id_token)=/.source,
};

function origin(host: string, port: number): string {
  return port === 443 ? `https://${host}` : `https://${host}:${port}`;
}

const line = (...rows: string[]): string => rows.join(String.fromCharCode(10));

/*
 * The page-side checks. Each is a function in the program, stringified into the
 * page and run there with its arguments, so only counts and booleans leave the
 * page: never a stored value, a cookie value or the page's text.
 */
const pageChecks = line(
  "const bodyTokens = async (args) => {",
  "  const shape = new RegExp(args.shape);",
  "  const reply = await fetch(args.url);",
  "  const text = await reply.text();",
  "  return { status: reply.status, host: new URL(reply.url).hostname, bodyTokens: shape.test(text) ? 1 : 0 };",
  "};",
  "const pageTokens = (args) => {",
  "  const shape = new RegExp(args.shape);",
  "  const name = new RegExp(args.name, 'i');",
  "  const storeTokens = (entries) => {",
  "    let found = 0;",
  "    for (let i = 0; i < entries.length; i++) {",
  "      const key = entries.key(i);",
  "      if (name.test(key) || shape.test(entries.getItem(key))) { found += 1; }",
  "    }",
  "    return found;",
  "  };",
  "  const cookies = document.cookie.split('; ').filter((pair) => pair !== '').filter((pair) => {",
  "    const eq = pair.indexOf('=');",
  "    return name.test(eq < 0 ? pair : pair.slice(0, eq)) || shape.test(eq < 0 ? '' : pair.slice(eq + 1));",
  "  }).length;",
  "  return { localStorage: storeTokens(localStorage), sessionStorage: storeTokens(sessionStorage), cookies: cookies, html: shape.test(document.documentElement.outerHTML) ? 1 : 0 };",
  "};",
);

/*
 * The Node-side helpers and the flow itself. The flow signs in as the test user,
 * runs the page-side checks after the sign-in, reads the signed-in page's network
 * log for redirects and the browser's stored cookies, and returns the seven assertions.
 */
const flowBody = line(
  "const shape = new RegExp(patterns.shape);",
  "const name = new RegExp(patterns.name, 'i');",
  "const parameter = new RegExp(patterns.parameter, 'i');",
  "const hostIs = (host) => 'location.hostname === ' + JSON.stringify(host);",
  "const headersOf = (response) => Object.fromEntries(Object.entries(response.headers || {}).map(([header, value]) => [header.toLowerCase(), String(value)]));",
  "const signedIn = await chromium.newPage();",
  "await chromium.go(signedIn, signInStartUrl);",
  "await chromium.waitFor(signedIn, hostIs(keycloakHost) + ' && !!document.querySelector(\"#kc-login\")', 'the Keycloak sign-in form');",
  "await chromium.type(signedIn, '#username', credentials.username);",
  "await chromium.type(signedIn, '#password', credentials.password);",
  "await chromium.evaluate(signedIn, 'document.querySelector(\"#kc-login\").click(), true');",
  "await chromium.waitFor(signedIn, hostIs(targetHost) + ' && document.readyState === \"complete\"', 'the target after sign-in');",
  "const call = await chromium.evaluate(signedIn, '(' + bodyTokens.toString() + ')(' + JSON.stringify({ shape: patterns.shape, url: signedInCallUrl }) + ')');",
  "const stores = await chromium.evaluate(signedIn, '(' + pageTokens.toString() + ')(' + JSON.stringify(patterns) + ')');",
  "const where = await chromium.evaluate(signedIn, 'location.href');",
  "const documents = signedIn.documents;",
  "const urls = [where].concat(documents.flatMap((response) => [response.url, headersOf(response).location || '']));",
  "const leaking = urls.filter((url) => shape.test(url) || parameter.test(url)).length;",
  "const sessionCookies = (await chromium.cookies(signedIn))",
  "  .filter((cookie) => cookie.domain.replace(/^[.]/, '') === targetHost)",
  "  .map((cookie) => ({ name: cookie.name, hostOnly: cookie.domain.charAt(0) !== '.', httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite }));",
  "return { assertions: [",
  "  { name: 'signed-in call succeeds', ok: call.status === 200 && call.host === targetHost, status: call.status, host: call.host },",
  "  { name: 'no token in localStorage', ok: stores.localStorage === 0, tokens: stores.localStorage },",
  "  { name: 'no token in sessionStorage', ok: stores.sessionStorage === 0, tokens: stores.sessionStorage },",
  "  { name: 'no token in non-HttpOnly cookies', ok: stores.cookies === 0, tokens: stores.cookies },",
  "  { name: 'no token in response bodies visible to the page', ok: call.bodyTokens + stores.html === 0, tokens: call.bodyTokens + stores.html },",
  "  { name: 'no token in URLs or redirects', ok: leaking === 0, tokens: leaking },",
  "  { name: 'every session cookie is host-only, HttpOnly, Secure and SameSite', ok: sessionCookies.length > 0 && sessionCookies.every((cookie) => cookie.hostOnly && cookie.httpOnly && cookie.secure && /^(lax|strict)$/i.test(cookie.sameSite || '')), cookies: sessionCookies },",
  "] };",
);

/**
 * The browser program of the token check. It signs in through Keycloak as the
 * test user, starting at the Service's own sign-in path, and then checks the
 * session. Its output is seven assertions: the token counts per channel, and the
 * session cookies' names and attributes. It holds no value, token or page text.
 */
export function signInTokenProgram(options: SignInTokenProgramOptions): string {
  const hostOrigin = origin(options.host, options.port);
  const constants = line(
    `const credentials = ${JSON.stringify({ username: options.username, password: options.password })};`,
    `const targetHost = ${JSON.stringify(options.host)};`,
    `const keycloakHost = ${JSON.stringify(options.keycloakHost)};`,
    `const signInStartUrl = ${JSON.stringify(hostOrigin + options.paths.startPath)};`,
    `const signedInCallUrl = ${JSON.stringify(hostOrigin + options.paths.signedInCallPath)};`,
    `const patterns = ${JSON.stringify(tokenPatterns)};`,
  );
  return chromiumProgram(
    [options.host, options.keycloakHost],
    line(constants, pageChecks, flowBody),
    { cookies: true },
  );
}
