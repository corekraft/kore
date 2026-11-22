import { describe, expect, it, vi } from "vitest";
import { signInProgram } from "./signin-program.js";
import {
  options,
  runFlow,
  type DocumentAnswer,
  type Scenario,
} from "./signin-program.fixtures.js";

vi.mock("./chromium-program.js", () => ({
  chromiumProgram: vi.fn((_hosts: readonly string[], flow: string) => flow),
}));

const serviceHost = "golden-path-example.platform.kore.internal";
const serviceAddress = `https://${serviceHost}/api/whoami`;
const serviceOptions = {
  ...options,
  host: serviceHost,
  paths: {
    startPath: "/oauth2/authorization/golden-path",
    signedInCallPath: "/api/whoami",
    anonymousPath: "/api/whoami",
  },
};

const serviceAnswer = (
  status: number,
  headers: Record<string, string> = {},
): DocumentAnswer => ({ url: serviceAddress, status, headers });

async function serviceOutcome(scenario: Scenario) {
  return runFlow(signInProgram(serviceOptions), scenario);
}

describe("the golden-path refusal and signed-in call", () => {
  it("accepts a 401 from /api/whoami to a request with no sign-in as a refusal", async () => {
    const { assertions } = await serviceOutcome({
      documents: [serviceAnswer(401)],
    });
    expect(assertions[1]).toMatchObject({ ok: true, status: 401 });
  });

  it("accepts a redirect to the Service's /oauth2/ as an absolute Location on its own host", async () => {
    const { assertions } = await serviceOutcome({
      documents: [
        serviceAnswer(302, {
          location: `https://${serviceHost}/oauth2/authorization/golden-path`,
        }),
      ],
    });
    expect(assertions[1]).toMatchObject({ ok: true, status: 302 });
  });

  it("fails a redirect to an absolute /oauth2/ path on another host", async () => {
    const { assertions } = await serviceOutcome({
      documents: [
        serviceAnswer(302, {
          location:
            "https://elsewhere.kore.internal/oauth2/authorization/golden-path",
        }),
      ],
    });
    expect(assertions[1]).toMatchObject({ ok: false, status: 302 });
  });

  it("judges the request on /api/whoami, so an answer only for the root leaves the refusal unseen", async () => {
    const { assertions } = await serviceOutcome({
      documents: [{ url: `https://${serviceHost}/`, status: 401 }],
    });
    expect(assertions[1]).toMatchObject({ ok: false, status: null });
  });

  it("passes the signed-in call when /api/whoami answers 200 on the Service's own host", async () => {
    const { assertions, evaluated } = await serviceOutcome({
      documents: [serviceAnswer(401)],
      call: { status: 200, host: serviceHost },
    });
    expect(assertions[0]).toMatchObject({ ok: true, status: 200 });
    expect(
      evaluated.some((expression) =>
        expression.includes(`fetch("${serviceAddress}")`),
      ),
    ).toBe(true);
  });

  it("fails a signed-in call that the Service's host did not answer", async () => {
    const { assertions } = await serviceOutcome({
      documents: [serviceAnswer(401)],
      call: { status: 200, host: "backstage.kore.internal" },
    });
    expect(assertions[0]).toMatchObject({ ok: false });
  });
});
