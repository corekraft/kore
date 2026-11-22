import { Script } from "node:vm";
import type { SignInAssertion } from "./signin-check.js";

// The token check's browser, faked in-process (ADR 0098). The browser flow runs
// in a VM context with a fake chromium API, and each page expression runs
// against fake page globals (storage, cookies, fetch, location, the DOM), so
// every channel is judged with no browser, no process and no real timer.

/** A JWT-shaped access token, the kind the golden-path session must never expose. */
// A fake token, assembled from its segments so no source line holds a JWT-shaped
// literal that a secret scanner reports. It is not a credential.
export const sessionToken = [
  "eyJhbGciOiJSUzI1NiJ9",
  "eyJzdWIiOiJrb3JlLXRlc3QifQ",
  "c2lnbmF0dXJlLWJ5dGVz",
].join(".");

export interface FakeDocument {
  url: string;
  status: number;
  headers?: Record<string, string>;
}

/** A cookie as the chromium api's cookies(page) returns it: attributes only, never a value. */
export interface FakeCookie {
  name: string;
  domain: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string | null;
}

export interface TokenPageScenario {
  /** The browser's stored cookies for the page. */
  cookies?: FakeCookie[];
  /** The signed-in page's network log of document responses. */
  documents?: FakeDocument[];
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  /** What document.cookie reads: the non-HttpOnly cookies. */
  cookie?: string;
  /** The page's DOM as HTML. */
  html?: string;
  /** location.href after the sign-in. */
  href?: string;
  /** What the page's fetch of the signed-in call gets back. */
  whoami?: { status: number; body: string };
}

export interface TokenFlowRun {
  assertions: SignInAssertion[];
  navigations: { url: string }[];
}

function store(entries: Record<string, string> = {}) {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (index: number) => keys[index],
    getItem: (key: string) => entries[key] ?? null,
  };
}

function pageGlobals(scenario: TokenPageScenario) {
  const whoami = scenario.whoami ?? {
    status: 200,
    body: '{"user":"kore-signin-check"}',
  };
  return {
    localStorage: store(scenario.localStorage),
    sessionStorage: store(scenario.sessionStorage),
    document: {
      cookie: scenario.cookie ?? "",
      readyState: "complete",
      documentElement: {
        outerHTML:
          scenario.html ?? '<html><body><div id="root"></div></body></html>',
      },
      querySelector: () => ({ click: () => undefined }),
    },
    location: {
      href:
        scenario.href ?? "https://golden-path-example.platform.kore.internal/",
    },
    fetch: (url: string) =>
      Promise.resolve({
        status: whoami.status,
        url,
        text: () => Promise.resolve(whoami.body),
      }),
    URL,
  };
}

/**
 * Runs a token-check browser flow against a fake signed-in page. The flow gets a
 * fake chromium API; its page expressions run in a VM over the fake page globals.
 */
export async function runTokenFlow(
  flow: string,
  scenario: TokenPageScenario,
): Promise<TokenFlowRun> {
  const navigations: { url: string }[] = [];
  const signedIn = {
    documents: (scenario.documents ?? []).map((document) => ({
      ...document,
      headers: document.headers ?? {},
    })),
  };
  const globals = pageGlobals(scenario);
  const chromium = {
    newPage: () => Promise.resolve(signedIn),
    go: (_page: unknown, url: string) => {
      navigations.push({ url });
      return Promise.resolve();
    },
    cookies: () => Promise.resolve(scenario.cookies ?? []),
    waitFor: () => Promise.resolve(),
    type: () => Promise.resolve(),
    evaluate: (_page: unknown, expression: string) =>
      Promise.resolve(new Script(expression).runInNewContext(globals)),
  };
  const run = new Script(
    "(async (chromium) => {" + flow + "})",
  ).runInNewContext({ URL }) as (
    browser: typeof chromium,
  ) => Promise<{ assertions: SignInAssertion[] }>;
  const reply = await run(chromium);
  return { assertions: reply.assertions, navigations };
}
