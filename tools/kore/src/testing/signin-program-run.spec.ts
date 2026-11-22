import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { signInProgram } from "./signin-program.js";

vi.mock("./chromium-program.js", () => ({
  chromiumProgram: vi.fn((_hosts: readonly string[], flow: string) => flow),
}));

const password = "Qx3-operator_pw-Rt8";
const options = {
  backstageHost: "backstage.kore.internal",
  keycloakHost: "keycloak.platform.kore.internal",
  port: 443,
  username: "kore-signin-check-a1",
  password,
};

// The browser flow is run in a fresh VM context against a fake chromium API, so
// each accepted refusal, and each leak that must fail, is judged with no browser,
// no process and no real timer. A fake timer resolves at once.

interface DocumentAnswer {
  url: string;
  status: number;
  headers?: Record<string, string>;
}
interface RefusedPage {
  title: string;
  signInPage: boolean;
  appRoot: boolean;
  appBundle: boolean;
}
interface Scenario {
  documents?: DocumentAnswer[];
  page?: RefusedPage;
  call?: { status: number; host: string };
}
interface Assertion {
  name: string;
  ok: boolean;
  [detail: string]: unknown;
}
interface FakePage {
  name: string;
  documents: DocumentAnswer[];
}
interface FakeChromium {
  newPage(): Promise<FakePage>;
  go(page: FakePage, url: string): Promise<void>;
  waitFor(page: FakePage, expression: string, what: string): Promise<void>;
  type(page: FakePage, selector: string, text: string): Promise<void>;
  evaluate(page: FakePage, expression: string): Promise<unknown>;
}

const backstageAddress = "https://backstage.kore.internal/";
const keycloakAddress =
  "https://keycloak.platform.kore.internal/realms/kore/protocol/openid-connect/auth";
const signInPage: RefusedPage = {
  title: "Sign In",
  signInPage: true,
  appRoot: false,
  appBundle: false,
};

const answer = (
  status: number,
  headers: Record<string, string> = {},
): DocumentAnswer => ({ url: backstageAddress, status, headers });

async function runFlow(
  flow: string,
  scenario: Scenario,
): Promise<{
  assertions: Assertion[];
  navigations: { page: string; url: string }[];
  evaluated: string[];
}> {
  const navigations: { page: string; url: string }[] = [];
  const evaluated: string[] = [];
  let opened = 0;
  const chromium: FakeChromium = {
    newPage: () => {
      opened += 1;
      return Promise.resolve(
        opened === 1
          ? { name: "signed-in", documents: [] }
          : { name: "anonymous", documents: scenario.documents ?? [] },
      );
    },
    go: (page, url) => {
      navigations.push({ page: page.name, url });
      return Promise.resolve();
    },
    waitFor: () => Promise.resolve(),
    type: () => Promise.resolve(),
    evaluate: (_page, expression) => {
      evaluated.push(expression);
      if (expression.includes("fetch(")) {
        return Promise.resolve(
          scenario.call ?? { status: 200, host: "backstage.kore.internal" },
        );
      }
      if (expression.includes("document.title")) {
        return Promise.resolve(scenario.page);
      }
      return Promise.resolve(true);
    },
  };
  const run = new Script(
    "(async (chromium) => {" + flow + "})",
  ).runInNewContext({ setTimeout: (done: () => void) => done() }) as (
    browser: FakeChromium,
  ) => Promise<{ assertions: Assertion[] }>;
  const reply = await run(chromium);
  return { assertions: reply.assertions, navigations, evaluated };
}

async function outcome(scenario: Scenario) {
  return runFlow(signInProgram(options), scenario);
}

async function refusalOf(scenario: Scenario): Promise<Assertion> {
  return (await outcome(scenario)).assertions[1] as Assertion;
}

describe("the sign-in flow's signed-in call target", () => {
  it("asks Backstage's readiness route on its own host, not the root the sign-in lands on, which Backstage answers with 404", async () => {
    const { evaluated } = await outcome({ documents: [answer(401)] });
    const call = evaluated.find((expression) => expression.includes("fetch("));
    expect(call).toBe(
      'fetch("https://backstage.kore.internal/.backstage/health/v1/readiness").then((reply) => ({ status: reply.status, host: new URL(reply.url).hostname }))',
    );
  });
});

describe("the sign-in flow's start and signed-in call", () => {
  it("starts the sign-in at the Backstage host's /oauth2/start with rd=/, and the refusal request at its root", async () => {
    const { navigations } = await outcome({ documents: [answer(401)] });
    expect(navigations).toEqual([
      {
        page: "signed-in",
        url: "https://backstage.kore.internal/oauth2/start?rd=/",
      },
      { page: "anonymous", url: backstageAddress },
    ]);
  });

  it("passes the signed-in call when Backstage answers 200 on its own host", async () => {
    const { assertions } = await outcome({
      documents: [answer(401)],
      call: { status: 200, host: "backstage.kore.internal" },
    });
    expect(assertions[0]).toMatchObject({
      name: "signed-in call succeeds",
      ok: true,
    });
  });

  it("fails the signed-in call unless it is a 200 on Backstage's own host", async () => {
    const notOk = await outcome({
      documents: [answer(401)],
      call: { status: 302, host: "backstage.kore.internal" },
    });
    const elsewhere = await outcome({
      documents: [answer(401)],
      call: { status: 200, host: "keycloak.platform.kore.internal" },
    });
    expect(notOk.assertions[0]?.ok).toBe(false);
    expect(elsewhere.assertions[0]?.ok).toBe(false);
  });

  it("accepts a 401 to a request with no sign-in as a refusal", async () => {
    expect(await refusalOf({ documents: [answer(401)] })).toMatchObject({
      ok: true,
      status: 401,
    });
  });

  it("accepts a redirect to /oauth2/ as a refusal", async () => {
    expect(
      await refusalOf({
        documents: [answer(302, { location: "/oauth2/start?rd=/" })],
      }),
    ).toMatchObject({ ok: true, status: 302 });
  });

  it("accepts a redirect to the Keycloak origin as a refusal", async () => {
    expect(
      await refusalOf({
        documents: [answer(302, { Location: keycloakAddress })],
      }),
    ).toMatchObject({ ok: true, status: 302 });
  });

  it("accepts a 403 that is the proxy's sign-in page with no Backstage app content, and reports only its status and title", async () => {
    const refusal = await refusalOf({
      documents: [answer(403)],
      page: signInPage,
    });
    expect(refusal).toEqual({
      name: "request with no sign-in is refused",
      ok: true,
      status: 403,
      location: null,
      title: "Sign In",
    });
  });
});

describe("the sign-in flow's refusal: Backstage content leaking through must fail", () => {
  it("fails a 403 whose page carries the Backstage app root, so app content leaking through is caught", async () => {
    expect(
      await refusalOf({
        documents: [answer(403)],
        page: { ...signInPage, appRoot: true },
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("fails a 403 whose page loads the Backstage app bundle", async () => {
    expect(
      await refusalOf({
        documents: [answer(403)],
        page: { ...signInPage, appBundle: true },
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("fails a 403 that is not the proxy's sign-in page", async () => {
    expect(
      await refusalOf({
        documents: [answer(403)],
        page: { ...signInPage, title: "Forbidden", signInPage: false },
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("fails a 200 answer to a request with no sign-in, which is Backstage content reaching an anonymous visitor", async () => {
    expect(
      await refusalOf({
        documents: [answer(200)],
        page: {
          title: "Backstage",
          signInPage: false,
          appRoot: true,
          appBundle: true,
        },
      }),
    ).toMatchObject({ ok: false, status: 200 });
  });

  it("fails a redirect to a host that is neither /oauth2/ nor Keycloak", async () => {
    expect(
      await refusalOf({
        documents: [
          answer(302, { location: "https://elsewhere.kore.internal/" }),
        ],
      }),
    ).toMatchObject({ ok: false, status: 302 });
  });

  it("fails when Backstage never answers the request with no sign-in", async () => {
    expect(await refusalOf({ documents: [] })).toMatchObject({
      ok: false,
      status: null,
    });
  });

  it("puts no password and no page body into the assertions", async () => {
    const { assertions } = await outcome({
      documents: [answer(403)],
      page: signInPage,
    });
    const printed = JSON.stringify(assertions);
    expect(printed).not.toContain(password);
    expect(printed).not.toContain("body");
  });
});
