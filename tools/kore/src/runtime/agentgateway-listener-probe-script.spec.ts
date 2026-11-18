import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Docs: docs/operations/agentgateway-listener-probe.md
// The probe answers one question for #1195: can agentgateway serve a TLS
// passthrough listener and an HTTPS terminating listener on one port, and can
// a listener set add one of them? The script is opt-in and creates a cluster,
// so these specs read it as text and pin the order of its phases.

const script = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../scripts/agentgateway-listener-probe.sh",
  ),
  "utf8",
);

const at = (needle: string, from = 0): number => script.indexOf(needle, from);
const must = (needle: string, from = 0): number => {
  const index = at(needle, from);
  expect(index, `the script must contain: ${needle}`).toBeGreaterThan(-1);
  return index;
};

describe("agentgateway listener probe, opt-in", () => {
  it("exits before touching anything unless KORE_RUN_AGENTGATEWAY_PROBE is 1", () => {
    const guard = must('[ "${KORE_RUN_AGENTGATEWAY_PROBE:-}" != "1" ]');
    expect(script.slice(guard)).toMatch(/^[^\n]*\n\s*echo "skipped: set/);
    expect(guard).toBeLessThan(must("exit 0"));
    expect(must("exit 0")).toBeLessThan(must('step "preflight'));
  });
});

describe("agentgateway listener probe, refusals", () => {
  it("refuses a k3d cluster of the same name before creating anything", () => {
    const refusal = must("already exists; this run would delete");
    expect(refusal).toBeLessThan(must("cluster create"));
    expect(refusal).toBeGreaterThan(must('step "preflight'));
  });

  it("refuses a taken host port before creating anything", () => {
    const refusal = must("is in use");
    expect(script).toContain("lsof -nP");
    expect(refusal).toBeLessThan(must("cluster create"));
    expect(refusal).toBeGreaterThan(must('step "preflight'));
  });

  it("sets the cleanup trap before it creates the cluster", () => {
    expect(must("trap cleanup EXIT")).toBeLessThan(must("cluster create"));
  });

  it("only ever deletes the cluster this run created, and only after the trap names it", () => {
    const cleanup = script.slice(
      must("cleanup() {"),
      must("trap cleanup EXIT"),
    );
    expect(cleanup).toContain('k3d cluster delete "$cluster"');
    expect(cleanup).toContain('"$created" = 1');
    expect(cleanup).toContain("KORE_PROBE_KEEP");
  });
});

describe("agentgateway listener probe, phase order", () => {
  const phases = [
    'step "preflight',
    'step "phase 1',
    'step "phase 2',
    'step "phase 3',
    'step "phase 4',
    'step "phase 5',
    'step "results',
  ];

  it("runs preflight, cluster, controller, certificates, mixed listeners, listener set and results in that order", () => {
    const positions = phases.map((phase) => must(phase));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("creates the cluster in phase 1 with the pinned k3s image and the host port on the node port", () => {
    const phase = script.slice(must('step "phase 1'), must('step "phase 2'));
    expect(phase).toContain("cluster create");
    expect(phase).toContain("--image");
    expect(phase).toContain("--kubeconfig-switch-context=false");
    expect(phase).toContain("$port:30443@loadbalancer");
    expect(phase).toContain("--disable=servicelb@server:*");
  });

  it("installs only the Gateway API definitions and the agentgateway charts in phase 2, at pinned versions", () => {
    const phase = script.slice(must('step "phase 2'), must('step "phase 3'));
    expect(phase).toContain("standard-install.yaml");
    expect(phase).toContain('--version "$agentgateway_version"');
    expect(phase).toContain("helm upgrade --install agentgateway-crds");
    expect(phase).toContain("helm upgrade --install agentgateway ");
    expect(must("helm upgrade --install agentgateway-crds")).toBeLessThan(
      must("helm upgrade --install agentgateway "),
    );
    expect(phase).toContain("rollout status deploy/agentgateway");
    expect(phase).not.toMatch(/cert-manager|istio|kore local up/);
  });

  it("makes the certificates and the stub backend in phase 3, before any Gateway", () => {
    const phase = script.slice(must('step "phase 3'), must('step "phase 4'));
    expect(phase).toContain("mkcert");
    expect(phase).toContain("CAROOT");
    expect(phase).toContain("rollout status deploy/probe-backend");
    expect(phase).not.toContain("kind: Gateway");
    expect(phase).not.toContain("kind: ListenerSet");
  });

  it("puts an HTTPS terminating and a TLS passthrough listener on one port of one Gateway in phase 4", () => {
    const phase = script.slice(must('step "phase 4'), must('step "phase 5'));
    expect(phase).toContain("kind: Gateway");
    expect(phase).toContain("protocol: HTTPS");
    expect(phase).toContain("mode: Terminate");
    expect(phase).toContain("protocol: TLS");
    expect(phase).toContain("mode: Passthrough");
    expect(phase.match(/port: 443/g)?.length).toBeGreaterThanOrEqual(2);
    expect(phase).toContain("kind: TLSRoute");
    expect(phase).toContain("kind: HTTPRoute");
    expect(phase).not.toContain("kind: ListenerSet");
  });

  it("puts one of the two listeners in a listener set in phase 5, after the mixed Gateway is checked and deleted", () => {
    const phase = script.slice(must('step "phase 5'), must('step "results'));
    expect(phase).toContain("kind: ListenerSet");
    expect(phase).toContain("allowedListeners");
    expect(phase).toContain("kind: Gateway");
    expect(must("delete gateway probe")).toBeGreaterThan(must('step "phase 4'));
    expect(must("delete gateway probe")).toBeLessThan(must('step "phase 5'));
  });
});

describe("agentgateway listener probe, what counts as working", () => {
  it("connects once for each name with SNI and compares the certificate fingerprint it gets with the certificate that name must carry", () => {
    expect(script).toContain("openssl s_client");
    expect(script).toContain('-servername "$name"');
    expect(script).toContain("-fingerprint -sha256");
    expect(script).toContain("terminate_fingerprint=");
    expect(script).toContain("passthrough_fingerprint=");
    expect(script).toContain(
      '[ "$terminate_fingerprint" != "$passthrough_fingerprint" ]',
    );
  });

  it("checks both names in both variants and records each as works or fails with the certificate seen", () => {
    const calls = script.match(/^check_variant "/gm) ?? [];
    expect(calls).toEqual(['check_variant "', 'check_variant "']);
    expect(script).toContain("mixed listeners: works");
    expect(script).toContain("mixed listeners: fails");
    expect(script).toContain("listener set: works");
    expect(script).toContain("listener set: fails");
  });

  it("records a failed variant instead of stopping, and names the registry fallback for a failed mixed variant", () => {
    expect(script).toContain("registry gets its own loopback port");
    expect(script).toContain("#1195");
    // a failing variant must never abort the run before the results file
    expect(script).toMatch(/check_variant[\s\S]*\|\| true/);
  });

  it("writes the results file outside git, from KORE_PROBE_RESULTS or under TMPDIR", () => {
    expect(script).toContain("KORE_PROBE_RESULTS");
    expect(script).toContain("${TMPDIR:-/tmp}");
    expect(script).toContain('tee "$results"');
  });
});

describe("agentgateway listener probe, safety", () => {
  it("names the cluster context on every kubectl and helm call, never the current one", () => {
    const kubectls = script.match(/kubectl(?! --context)/g) ?? [];
    expect(kubectls).toEqual([]);
    const helms = script
      .split("\n")
      .filter((line) => /\bhelm (upgrade|install|uninstall)/.test(line));
    expect(helms.length).toBeGreaterThan(0);
    for (const line of helms) {
      expect(line).toContain('--kube-context "$context"');
    }
  });

  it("keeps the scratch files outside git and removes them on exit", () => {
    expect(script).toContain("mktemp -d");
    expect(script).toContain('rm -rf "$work"');
    expect(script).not.toContain("git/info/exclude");
  });
});
