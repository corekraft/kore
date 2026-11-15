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
const phase4 = script.slice(script.indexOf('step "phase 4'));
const at = (needle: string): number => phase4.indexOf(needle);

describe("agentgateway live proof, phase 4 rollback", () => {
  it("uninstalls agentgateway, then its CRDs, before the final kore local up", () => {
    const release = at(
      'helm uninstall agentgateway --namespace agentgateway-system --kube-context "$context"',
    );
    const crds = at(
      'helm uninstall agentgateway-crds --namespace agentgateway-system --kube-context "$context"',
    );
    const up = at("kore local up --environment");
    expect(release).toBeGreaterThan(-1);
    expect(crds).toBeGreaterThan(release);
    expect(up).toBeGreaterThan(crds);
  });

  it("refuses the local environment and the kore-local context before any uninstall", () => {
    const first = at("helm uninstall");
    const scratchGuard = at('[ "$scratch" != "local" ]');
    const contextGuard = at('[ "$context" != "k3d-kore-local" ]');
    const envGuard = at(
      'grep -qF "\\"kubeContext\\": \\"$context\\"" "$env_file"',
    );
    for (const guard of [scratchGuard, contextGuard, envGuard]) {
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(first);
    }
  });

  it("stops before any uninstall when the CRD listing fails", () => {
    const list = at('crds="$(k get crd -o name)" || fail');
    expect(list).toBeGreaterThan(-1);
    expect(list).toBeLessThan(at("helm uninstall"));
    expect(phase4).not.toContain("$(k get crd -o name |");
  });

  it("stops before any uninstall when listing the resources of a kind fails", () => {
    const listing = at('k get "$crd" --all-namespaces -o name) || fail');
    expect(listing).toBeGreaterThan(-1);
    expect(listing).toBeLessThan(at("helm uninstall"));
  });
});
