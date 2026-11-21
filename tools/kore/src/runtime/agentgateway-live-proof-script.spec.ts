import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../scripts/agentgateway-live-proof.sh",
  ),
  "utf8",
);
const phase2 = script.slice(
  script.indexOf('step "phase 2'),
  script.indexOf('step "phase 3'),
);
const phase4 = script.slice(script.indexOf('step "phase 4'));
const at = (needle: string): number => phase4.indexOf(needle);

const firstUp = at("kore local up --environment");
const secondUp = phase4.indexOf("kore local up --environment", firstUp + 1);
const firstUninstall = at("mise exec -- helm uninstall");

describe("agentgateway live proof, phase 4 rollback", () => {
  it("expects the first kore local up to fail with the gated-off refusal, and fails the proof if it succeeds", () => {
    const expected = at('if up_out="$(kore local up');
    expect(expected).toBeGreaterThan(-1);
    expect(firstUp).toBeGreaterThanOrEqual(expected);
    expect(at("kore local up succeeded while gated-off")).toBeGreaterThan(
      expected,
    );
    expect(phase4).toContain("is gated off");
    expect(phase4).toContain("helm uninstall");
    expect(at("is gated off")).toBeGreaterThan(expected);
    expect(at("is gated off")).toBeLessThan(firstUninstall);
  });

  it("asserts the Gateway is on the istio class, Kore's parameters are gone and Istio's proxy is back, before any uninstall", () => {
    for (const needle of [
      "{.spec.gatewayClassName}",
      "gone agentgatewayparameters.agentgateway.dev kore-gateway-service",
      "get deploy kore-gateway-istio",
    ]) {
      expect(at(needle)).toBeGreaterThan(firstUp);
      expect(at(needle)).toBeLessThan(firstUninstall);
    }
  });

  it("uninstalls agentgateway, then its CRDs, between the refused run and the converging run", () => {
    const release = at(
      'helm uninstall agentgateway --namespace agentgateway-system --kube-context "$context"',
    );
    const crds = at(
      'helm uninstall agentgateway-crds --namespace agentgateway-system --kube-context "$context"',
    );
    expect(release).toBeGreaterThan(firstUp);
    expect(crds).toBeGreaterThan(release);
    expect(secondUp).toBeGreaterThan(crds);
  });

  it("refuses the local environment and the kore-local context before any uninstall", () => {
    const scratchGuard = at('[ "$scratch" != "local" ]');
    const contextGuard = at('[ "$context" != "k3d-kore-local" ]');
    const envGuard = at(
      'grep -qF "\\"kubeContext\\": \\"$context\\"" "$env_file"',
    );
    for (const guard of [scratchGuard, contextGuard, envGuard]) {
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(firstUninstall);
    }
  });

  it("stops before any uninstall when the CRD listing fails", () => {
    const list = at('crds="$(k get crd -o name)" || fail');
    expect(list).toBeGreaterThan(-1);
    expect(list).toBeLessThan(firstUninstall);
    expect(phase4).not.toContain("$(k get crd -o name |");
  });

  it("stops before any uninstall when listing the resources of a kind fails", () => {
    const listing = at(
      'found="$(k get "$crd" --all-namespaces -o name)" || fail',
    );
    expect(listing).toBeGreaterThan(-1);
    expect(listing).toBeLessThan(firstUninstall);
  });
});

describe("agentgateway live proof, phase 4 rollback, the deletions", () => {
  it("deletes nothing by hand: Helm removes Kore's own AgentgatewayParameters", () => {
    expect(phase4).not.toMatch(/\bk (-n \S+ )?delete\b/);
  });

  it("still fails for any other Agentgateway custom resource, and ignores nothing by name", () => {
    expect(at("Agentgateway custom resources exist")).toBeGreaterThan(
      at('found="$(k get "$crd" --all-namespaces -o name)" || fail'),
    );
    expect(phase4).toContain('[ -z "$crs" ] || fail');
    expect(phase4).not.toContain("grep -v");
  });

  it("ends with a converging run, then a third run that changes no Helm revision", () => {
    expect(at('[ "$(gateway_state)" = "ready" ]')).toBeGreaterThan(secondUp);
    expect(at("assert_no_revision_change")).toBeGreaterThan(secondUp);
  });

  it("enables gateway-rollback-order in the throwaway overlay in phase 2, and leaves it on through phase 4", () => {
    expect(phase2).toContain(
      `-e 's/"gateway-rollback-order": false/"gateway-rollback-order": true/'`,
    );
    expect(phase2).toContain(
      `grep -qF '"gateway-rollback-order": true' "$env_file"`,
    );
    expect(phase4).not.toContain('"gateway-rollback-order": false/');
  });
});

describe("agentgateway live proof, mesh enrollment", () => {
  it("enables agentgateway-mesh-enrollment with the other flags in phase 2, and leaves it on through phase 4", () => {
    expect(script).toContain('"agentgateway-mesh-enrollment": false\'');
    expect(phase2).toContain(
      `-e 's/"agentgateway-mesh-enrollment": false/"agentgateway-mesh-enrollment": true/'`,
    );
    expect(phase2).toContain(
      `grep -qF '"agentgateway-mesh-enrollment": true' "$env_file"`,
    );
    expect(phase4).not.toContain('"agentgateway-mesh-enrollment": false/');
  });

  it("sends a request through the Gateway after phase 2 and fails unless the reference route answers 200", () => {
    const request = phase2.indexOf("curl");
    expect(request).toBeGreaterThan(
      phase2.indexOf("gone svc kore-gateway-istio"),
    );
    expect(phase2).toContain("--resolve kore.internal:443:127.0.0.1");
    expect(phase2).toContain("https://kore.internal/livez");
    expect(phase2).toContain('[ "$status" = "200" ] || fail');
    expect(phase2.indexOf("phase 2 ok")).toBeGreaterThan(request);
  });
});
