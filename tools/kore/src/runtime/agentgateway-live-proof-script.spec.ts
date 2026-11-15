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

  it("refuses any context other than the throwaway profile's before uninstalling", () => {
    const guard = at('[ "$context" = "k3d-kore-$scratch" ]');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(at("helm uninstall"));
  });

  it("asserts no Agentgateway custom resources remain before uninstalling the CRDs", () => {
    const check = at("k get crd -o name");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(at("helm uninstall"));
  });
});
