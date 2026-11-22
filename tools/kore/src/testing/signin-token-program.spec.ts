import { describe, expect, it, vi } from "vitest";
import { signInTokenProgram } from "./signin-token-program.js";
import {
  runTokenFlow,
  type FakeCookie,
  sessionToken,
  type TokenPageScenario,
} from "./signin-token-program.fixtures.js";

vi.mock("./chromium-program.js", () => ({
  chromiumProgram: vi.fn((_hosts: readonly string[], flow: string) => flow),
}));

const host = "golden-path-example.platform.kore.internal";
const keycloakHost = "keycloak.platform.kore.internal";
const origin = `https://${host}`;
const password = "Qx3-token-pw-Rt8";
const options = {
  host,
  keycloakHost,
  port: 443,
  username: "kore-signin-check-a1",
  password,
  paths: {
    startPath: "/oauth2/authorization/golden-path",
    signedInCallPath: "/api/whoami",
    anonymousPath: "/api/whoami",
  },
};
const storedCookie = (overrides: Partial<FakeCookie> = {}): FakeCookie => ({
  name: "SESSION",
  domain: host,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  ...overrides,
});
const cookieCheck =
  "every session cookie is host-only, HttpOnly, Secure and SameSite";

// A signed-in session that holds no token in any channel, with one session cookie.
const clean: TokenPageScenario = {
  documents: [
    {
      url: `${origin}/login/oauth2/code/golden-path?code=authorization-code&state=state-value`,
      status: 302,
      headers: { location: `${origin}/` },
    },
    { url: `${origin}/`, status: 200 },
  ],
  cookies: [storedCookie()],
};

const run = (scenario: TokenPageScenario) =>
  runTokenFlow(signInTokenProgram(options), scenario);

const cookieOf = (overrides: Record<string, unknown>) => ({
  name: "SESSION",
  hostOnly: true,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  ...overrides,
});

type ChannelCase = [
  label: string,
  scenario: TokenPageScenario,
  failing: string,
  tokens: number,
];

const channelCases: ChannelCase[] = [
  [
    "a token value in localStorage",
    { localStorage: { "kore.session": sessionToken } },
    "no token in localStorage",
    1,
  ],
  [
    "a token-named key in localStorage",
    { localStorage: { access_token: "opaque-value" } },
    "no token in localStorage",
    1,
  ],
  [
    "a token value in sessionStorage",
    { sessionStorage: { session: sessionToken } },
    "no token in sessionStorage",
    1,
  ],
  [
    "a token value in a non-HttpOnly cookie",
    { cookie: `theme=dark; idp=${sessionToken}` },
    "no token in non-HttpOnly cookies",
    1,
  ],
  [
    "a token-named non-HttpOnly cookie",
    { cookie: "refresh_token=opaque-value" },
    "no token in non-HttpOnly cookies",
    1,
  ],
  [
    "a token in the signed-in call's response body",
    {
      whoami: {
        status: 200,
        body: JSON.stringify({ accessToken: sessionToken }),
      },
    },
    "no token in response bodies visible to the page",
    1,
  ],
  [
    "a token in the DOM the page renders",
    { html: `<html><script>window.t = "${sessionToken}"</script></html>` },
    "no token in response bodies visible to the page",
    1,
  ],
  [
    "a token in a document's fragment",
    {
      documents: [
        ...(clean.documents ?? []),
        { url: `${origin}/#id_token=${sessionToken}`, status: 200 },
      ],
    },
    "no token in URLs or redirects",
    1,
  ],
  [
    "a token in a redirect's Location header",
    {
      documents: [
        ...(clean.documents ?? []),
        {
          url: `${origin}/login`,
          status: 302,
          headers: { location: `${origin}/?state=${sessionToken}` },
        },
      ],
    },
    "no token in URLs or redirects",
    1,
  ],
  [
    "a refresh token in the page's address",
    { href: `${origin}/#refresh_token=opaque-value` },
    "no token in URLs or redirects",
    1,
  ],
];

describe("the session token check, on a session that holds no token", () => {
  it("passes every channel and names the one session cookie with its attributes", async () => {
    const { assertions } = await run(clean);
    expect(assertions).toEqual([
      { name: "signed-in call succeeds", ok: true, status: 200, host },
      { name: "no token in localStorage", ok: true, tokens: 0 },
      { name: "no token in sessionStorage", ok: true, tokens: 0 },
      { name: "no token in non-HttpOnly cookies", ok: true, tokens: 0 },
      {
        name: "no token in response bodies visible to the page",
        ok: true,
        tokens: 0,
      },
      { name: "no token in URLs or redirects", ok: true, tokens: 0 },
      { name: cookieCheck, ok: true, cookies: [cookieOf({})] },
    ]);
  });

  it("signs in at the target's own start path, and calls the target's own signed-in path", async () => {
    const { navigations } = await run(clean);
    expect(navigations).toEqual([
      { url: `${origin}/oauth2/authorization/golden-path` },
    ]);
  });
});

describe("the session token check, one channel at a time", () => {
  it.each(channelCases)(
    "fails the check by name when the session holds %s",
    async (_label, scenario, failing, tokens) => {
      const { assertions } = await run({ ...clean, ...scenario });
      expect(assertions.filter((assertion) => !assertion.ok)).toEqual([
        { name: failing, ok: false, tokens },
      ]);
    },
  );
});

describe("the session token check's output", () => {
  it("never prints a token or the password, whichever channel holds it", async () => {
    const { assertions } = await run({
      localStorage: { a: sessionToken },
      sessionStorage: { b: sessionToken },
      cookie: `idp=${sessionToken}`,
      html: `<script>${sessionToken}</script>`,
      href: `${origin}/#id_token=${sessionToken}`,
      documents: [
        {
          url: `${origin}/`,
          status: 302,
          headers: { location: `${origin}/?x=${sessionToken}` },
        },
      ],
      cookies: [storedCookie()],
    });
    const printed = JSON.stringify(assertions);
    expect(printed).not.toContain(sessionToken);
    expect(printed).not.toContain(password);
  });

  it("fails the signed-in call assertion by name when the call is not 200", async () => {
    const { assertions } = await run({
      ...clean,
      whoami: { status: 401, body: "" },
    });
    expect(assertions[0]).toEqual({
      name: "signed-in call succeeds",
      ok: false,
      status: 401,
      host,
    });
  });
});
