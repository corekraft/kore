import { describe, expect, it } from "vitest";
import { backstageDeliveryProgram } from "./backstage-delivery-program.js";

const options = {
  host: "backstage.platform.kore.internal",
  keycloakHost: "keycloak.platform.kore.internal",
  port: 443,
  username: "kore-signin-check-a1",
  password: "pw-generated-in-memory",
  service: "golden-path-example",
};

describe("backstageDeliveryProgram", () => {
  const program = backstageDeliveryProgram(options);

  it("signs in through the proxy, then through Backstage's own OIDC flow, to get the identity every API call needs", () => {
    expect(program).toContain("/oauth2/start?rd=/");
    expect(program).toContain("/api/auth/oidc/start?env=production");
    expect(program).toContain("/api/auth/oidc/refresh?env=production");
    expect(program).toContain("X-Requested-With");
  });

  it("reads the service's catalog entity and its Kubernetes view with that identity", () => {
    expect(program).toContain(
      "/api/catalog/entities/by-name/component/default/",
    );
    expect(program).toContain("/api/kubernetes/services/");
    expect(program).toContain("golden-path-example");
  });

  it("names the four assertions", () => {
    for (const name of [
      "backstage identity carries the operators group",
      "catalog lists the delivered service",
      "kubernetes read returns the service's Argo CD Application with its sync and health",
      "kubernetes read returns the service's workload with its rollout",
    ]) {
      expect(program).toContain(name);
    }
  });

  it("returns no token, cookie or page body: only statuses, names and the sync, health and replica counts", () => {
    const returned = program.slice(program.lastIndexOf("return {"));
    expect(returned).not.toMatch(/token|cookie|Authorization|text/i);
  });

  it("is plain program text for the browser, with both hosts allowed", () => {
    expect(program).toContain("backstage.platform.kore.internal");
    expect(program).toContain("keycloak.platform.kore.internal");
  });
});
