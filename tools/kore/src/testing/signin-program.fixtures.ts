import { Script } from "node:vm";

export const password = "Qx3-operator_pw-Rt8";
export const options = {
  host: "backstage.kore.internal",
  keycloakHost: "keycloak.platform.kore.internal",
  port: 443,
  username: "kore-signin-check-a1",
  password,
};

// The browser flow is run in a fresh VM context against a fake chromium API, so
// each accepted refusal, and each leak that must fail, is judged with no browser,
// no process and no real timer. A fake timer resolves at once.

export interface DocumentAnswer {
  url: string;
  status: number;
  headers?: Record<string, string>;
}
export interface RefusedPage {
  title: string;
  signInPage: boolean;
  appRoot: boolean;
  appBundle: boolean;
}
export interface Scenario {
  documents?: DocumentAnswer[];
  page?: RefusedPage;
  call?: { status: number; host: string };
}
export interface Assertion {
  name: string;
  ok: boolean;
  [detail: string]: unknown;
}
export interface FakePage {
  name: string;
  documents: DocumentAnswer[];
}
export interface FakeChromium {
  newPage(): Promise<FakePage>;
  go(page: FakePage, url: string): Promise<void>;
  waitFor(page: FakePage, expression: string, what: string): Promise<void>;
  type(page: FakePage, selector: string, text: string): Promise<void>;
  evaluate(page: FakePage, expression: string): Promise<unknown>;
}

export async function runFlow(
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
