import { Script } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chromiumProgram } from "./chromium-program.js";
import { signInProgram } from "./signin-program.js";

vi.mock("./chromium-program.js", () => ({
  chromiumProgram: vi.fn((_hosts: readonly string[], flow: string) => flow),
}));

const password = "Qx3-operator_pw-Rt8";
const options = {
  host: "backstage.kore.internal",
  keycloakHost: "keycloak.platform.kore.internal",
  port: 443,
  username: "kore-signin-check-a1",
  password,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("signInProgram", () => {
  it("hands exactly the Backstage and Keycloak hosts to the browser program", () => {
    signInProgram(options);
    expect(chromiumProgram).toHaveBeenCalledWith(
      ["backstage.kore.internal", "keycloak.platform.kore.internal"],
      expect.any(String),
    );
  });

  it("names both assertions the check reports, in the flow it hands the browser", () => {
    const flow = signInProgram(options);
    expect(flow).toContain("name: 'signed-in call succeeds'");
    expect(flow).toContain("name: 'request with no sign-in is refused'");
  });

  it("carries the password once, as a literal in the flow, so it is streamed and never repeated", () => {
    const flow = signInProgram(options);
    expect(flow.split(password).length - 1).toBe(1);
  });

  it("gives the browser a flow that parses inside its async session callback", () => {
    const flow = signInProgram(options);
    expect(
      () => new Script("(async (chromium) => {" + flow + "})"),
    ).not.toThrow();
  });

  it("compares hostnames rather than host and port, so a non-default port still matches the expected page", () => {
    const flow = signInProgram({ ...options, port: 8443 });
    expect(flow).toContain("location.hostname === ");
    expect(flow).toContain("reply.url).hostname");
    expect(flow).not.toContain("location.host ===");
  });

  it("judges the first document answer to a request with no sign-in, not the page it finally lands on", () => {
    const flow = signInProgram(options);
    expect(flow).toContain("anonymous.documents.some(");
    expect(flow).not.toContain(
      "hostIs(keycloakHost) + ' && document.readyState",
    );
  });

  it("names the Keycloak host it is given in the sign-in form and the refused-request redirect, so both name the same host", () => {
    const flow = signInProgram(options);
    expect(flow).toContain(
      'const keycloakHost = "keycloak.platform.kore.internal";',
    );
    expect(flow).toContain(
      'const keycloakOrigin = "https://keycloak.platform.kore.internal";',
    );
  });

  it("leaves 443 out of the URLs and names a non-default port in them", () => {
    expect(signInProgram(options)).toContain(
      'const anonymousUrl = "https://backstage.kore.internal/";',
    );
    expect(signInProgram({ ...options, port: 8443 })).toContain(
      'const anonymousUrl = "https://backstage.kore.internal:8443/";',
    );
  });
});

const serviceHost = "golden-path-example.platform.kore.internal";
const goldenPaths = {
  startPath: "/oauth2/authorization/golden-path",
  signedInCallPath: "/api/whoami",
  anonymousPath: "/api/whoami",
};

describe("signInProgram on a golden-path Service", () => {
  const serviceOptions = { ...options, host: serviceHost, paths: goldenPaths };

  it("starts at the Service's Spring sign-in, calls /api/whoami signed in, and makes its anonymous request there", () => {
    const flow = signInProgram(serviceOptions);
    expect(flow).toContain(
      'const signInStartUrl = "https://golden-path-example.platform.kore.internal/oauth2/authorization/golden-path";',
    );
    expect(flow).toContain(
      'const signedInCallUrl = "https://golden-path-example.platform.kore.internal/api/whoami";',
    );
    expect(flow).toContain(
      'const anonymousUrl = "https://golden-path-example.platform.kore.internal/api/whoami";',
    );
  });

  it("hands the browser the Service's host and Keycloak's, and no Backstage host", () => {
    signInProgram(serviceOptions);
    expect(chromiumProgram).toHaveBeenCalledWith(
      [
        "golden-path-example.platform.kore.internal",
        "keycloak.platform.kore.internal",
      ],
      expect.any(String),
    );
  });

  it("keeps Backstage's own start, readiness and root paths when no paths are given", () => {
    const flow = signInProgram(options);
    expect(flow).toContain(
      'const signInStartUrl = "https://backstage.kore.internal/oauth2/start?rd=/";',
    );
    expect(flow).toContain(
      'const signedInCallUrl = "https://backstage.kore.internal/.backstage/health/v1/readiness";',
    );
    expect(flow).toContain(
      'const anonymousUrl = "https://backstage.kore.internal/";',
    );
  });
});
