import { describe, expect, it, vi } from "vitest";
import { chromiumProgram } from "./chromium-program.js";
import { signInTokenProgram } from "./signin-token-program.js";
import {
  runTokenFlow,
  type FakeCookie,
  type TokenPageScenario,
} from "./signin-token-program.fixtures.js";

vi.mock("./chromium-program.js", () => ({
  chromiumProgram: vi.fn((_hosts: readonly string[], flow: string) => flow),
}));

const host = "golden-path-example.platform.kore.internal";
const keycloakHost = "keycloak.platform.kore.internal";
const options = {
  host,
  keycloakHost,
  port: 443,
  username: "kore-signin-check-a1",
  password: "Qx3-token-pw-Rt8",
  paths: {
    startPath: "/oauth2/authorization/golden-path",
    signedInCallPath: "/api/whoami",
    anonymousPath: "/api/whoami",
  },
};
const cookieCheck =
  "every session cookie is host-only, HttpOnly, Secure and SameSite";

const storedCookie = (overrides: Partial<FakeCookie> = {}): FakeCookie => ({
  name: "SESSION",
  domain: host,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  ...overrides,
});

const run = (scenario: TokenPageScenario) =>
  runTokenFlow(signInTokenProgram(options), scenario);

const sessionCookie = (cookie: FakeCookie): TokenPageScenario => ({
  cookies: [cookie],
});

const cookieOf = (overrides: Record<string, unknown>) => ({
  name: "SESSION",
  hostOnly: true,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  ...overrides,
});

type CookieCase = [
  label: string,
  cookie: FakeCookie,
  broken: Record<string, unknown>,
];

const cookieCases: CookieCase[] = [
  ["lacks HttpOnly", storedCookie({ httpOnly: false }), { httpOnly: false }],
  ["lacks Secure", storedCookie({ secure: false }), { secure: false }],
  ["lacks SameSite", storedCookie({ sameSite: null }), { sameSite: null }],
  [
    "is SameSite=None",
    storedCookie({ sameSite: "None" }),
    { sameSite: "None" },
  ],
  [
    "has a leading-dot domain, so it is not host-only",
    storedCookie({ domain: `.${host}` }),
    { hostOnly: false },
  ],
];

describe("the session cookie's attributes", () => {
  it.each(cookieCases)(
    "fails the check when the session cookie %s",
    async (_label, cookie, broken) => {
      const { assertions } = await run(sessionCookie(cookie));
      expect(assertions[6]).toEqual({
        name: cookieCheck,
        ok: false,
        cookies: [cookieOf(broken)],
      });
    },
  );

  it("passes a session cookie that is SameSite=Strict", async () => {
    const { assertions } = await run(
      sessionCookie(storedCookie({ sameSite: "Strict" })),
    );
    expect(assertions[6]).toEqual({
      name: cookieCheck,
      ok: true,
      cookies: [cookieOf({ sameSite: "Strict" })],
    });
  });

  it("fails the check when the target sets no session cookie at all", async () => {
    const { assertions } = await run({
      cookies: [],
    });
    expect(assertions[6]).toEqual({
      name: cookieCheck,
      ok: false,
      cookies: [],
    });
  });
});

describe("the session cookies the token check judges", () => {
  it("judges only the cookies stored for the target's host, not Keycloak's", async () => {
    const { assertions } = await run({
      cookies: [
        storedCookie(),
        storedCookie({
          name: "AUTH_SESSION_ID",
          domain: keycloakHost,
          httpOnly: false,
          secure: false,
          sameSite: null,
        }),
      ],
    });
    expect(assertions[6]).toEqual({
      name: cookieCheck,
      ok: true,
      cookies: [cookieOf({})],
    });
  });

  it("judges a cookie whose domain carries a leading dot as the target's, and not host-only", async () => {
    const { assertions } = await run({
      cookies: [storedCookie({ domain: `.${host}` })],
    });
    expect(assertions[6]).toEqual({
      name: cookieCheck,
      ok: false,
      cookies: [cookieOf({ hostOnly: false })],
    });
  });

  it("does not judge a cookie of a different host that only ends in the target's name", async () => {
    const { assertions } = await run({
      cookies: [storedCookie({ domain: `evil-${host}` })],
    });
    expect(assertions[6]).toEqual({
      name: cookieCheck,
      ok: false,
      cookies: [],
    });
  });

  it("asks the browser program for the cookies method", () => {
    signInTokenProgram(options);
    expect(chromiumProgram).toHaveBeenLastCalledWith(
      [host, keycloakHost],
      expect.any(String),
      { cookies: true },
    );
  });
});
