import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { signInProgram } from "./signin-program.js";

const password = "Qx3-operator_pw-Rt8";
const options = {
  domain: "kore.internal",
  port: 443,
  username: "kore-signin-check-a1",
  password,
};

describe("signInProgram", () => {
  it("maps exactly the Backstage and Keycloak hosts to loopback", () => {
    expect(signInProgram(options)).toContain(
      'const hosts = ["backstage.kore.internal","keycloak.kore.internal"];',
    );
  });

  it("names both assertions the check reports, and nothing else", () => {
    const program = signInProgram(options);
    expect(program).toContain("name: 'signed-in call succeeds'");
    expect(program).toContain("name: 'request with no sign-in is refused'");
  });

  it("carries the password once, as a literal in the program, so it is streamed and never repeated", () => {
    const program = signInProgram(options);
    expect(program.split(password).length - 1).toBe(1);
  });

  it("parses as a script", () => {
    expect(() => new Script(signInProgram(options))).not.toThrow();
  });

  it("compares hostnames rather than host and port, so a non-default port still matches the expected page", () => {
    const program = signInProgram({ ...options, port: 8443 });
    expect(program).toContain("location.hostname === ");
    expect(program).toContain("reply.url).hostname");
    expect(program).not.toContain("location.host ===");
  });

  it("judges the first document answer to a request with no sign-in, not the page it finally lands on", () => {
    const program = signInProgram(options);
    expect(program).toContain("anonymous.documents.some(");
    expect(program).not.toContain(
      "hostIs(keycloakHost) + ' && document.readyState",
    );
  });

  it("leaves 443 out of the URLs and names a non-default port in them", () => {
    expect(signInProgram(options)).toContain(
      'const backstageUrl = "https://backstage.kore.internal/";',
    );
    expect(signInProgram({ ...options, port: 8443 })).toContain(
      'const backstageUrl = "https://backstage.kore.internal:8443/";',
    );
  });
});
