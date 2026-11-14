// Docs: infra/plans/14-test-tiers.md#step-2-pilots
// Docs: docs/decisions/0067-platform-readiness-manifest-and-evidence.md
import { beforeEach, expect, test, vi } from "vitest";
import { CommandError, type Runner } from "../runtime/index.js";
import {
  admissionGateFieldManager,
  admissionGateStatusName,
  platformGeneration,
} from "./admission-gate.js";
import {
  evaluateReadiness,
  readinessEvidenceObject,
  readinessFailureSummary,
  recordReadinessEvidence,
  tryRecordReadinessEvidence,
  type ReadinessEvidence,
} from "./readiness-manifest.js";
import { manifest, repositoryWith, row } from "./readiness-manifest-support.js";

vi.mock("./admission-gate.js");

type Run = Runner["run"];

const when = new Date("2026-11-08T12:00:00.000Z");

beforeEach(() => {
  vi.mocked(platformGeneration).mockReturnValue("gen-7");
});

test("evidence is open with no failures when every prerequisite is ready", () => {
  const evidence = evaluateReadiness(
    manifest,
    [
      row("gateway", "ready"),
      row("policy", "ready"),
      row("gate", "ready"),
      row("registry-trust", "ready"),
    ],
    when,
  );

  expect(evidence).toMatchObject({
    manifestVersion: 1,
    environment: "local",
    context: "k3d-kore-local",
    generation: "gen-7",
    state: "open",
    evaluatedAt: "2026-11-08T12:00:00.000Z",
    failures: [],
  });
  expect(evidence.requirements.map(({ status }) => status)).toEqual([
    "ready",
    "ready",
  ]);
});

test("a degraded prerequisite closes the evidence and is listed as a failure of its requirement", () => {
  const evidence = evaluateReadiness(
    manifest,
    [
      row("gateway", "degraded", "pod crashlooping"),
      row("policy", "ready"),
      row("gate", "ready"),
      row("registry-trust", "ready"),
    ],
    when,
  );

  expect(evidence.state).toBe("closed");
  expect(evidence.failures).toEqual([
    {
      requirement: "gateway-ready",
      name: "gateway",
      status: "degraded",
      detail: "pod crashlooping",
    },
  ]);
  expect(evidence.requirements[0]?.status).toBe("failed");
});

test("a prerequisite with no status row is missing, so an incomplete read can never open the gate", () => {
  const evidence = evaluateReadiness(manifest, [row("gateway", "ready")], when);

  expect(evidence.state).toBe("closed");
  expect(evidence.failures).toContainEqual({
    requirement: "policy-ready",
    name: "policy",
    status: "missing",
    detail: "no status was reported for this prerequisite",
  });
});

test("a gated-off prerequisite is not counted, and a requirement whose every component is gated off is skipped", () => {
  const evidence = evaluateReadiness(
    repositoryWith([
      {
        name: "policy-ready",
        step: 2,
        capability: "policy",
        components: ["policy"],
      },
    ]),
    [row("policy", "gated-off")],
    when,
  );

  expect(evidence.state).toBe("open");
  expect(evidence.requirements[0]).toMatchObject({
    status: "skipped",
    checks: [],
  });
});

test("the admission gate's own row never satisfies a prerequisite that names it", () => {
  const evidence = evaluateReadiness(
    repositoryWith([
      {
        name: "gate-ready",
        step: 3,
        capability: "gate",
        components: [admissionGateStatusName],
      },
    ]),
    [row(admissionGateStatusName, "ready")],
    when,
  );

  expect(evidence.state).toBe("closed");
  expect(evidence.failures[0]?.status).toBe("missing");
});

test("a requirement that names no components at all is ready, since nothing in it can fail", () => {
  const evidence = evaluateReadiness(
    repositoryWith([{ name: "empty", step: 4, capability: "none" }]),
    [],
    when,
  );

  expect(evidence.state).toBe("open");
  expect(evidence.requirements[0]?.status).toBe("ready");
});

test("the failure summary names each failing requirement, prerequisite and detail, in order", () => {
  const evidence = {
    failures: [
      {
        requirement: "gateway-ready",
        name: "gateway",
        status: "degraded",
        detail: "crashloop",
      },
      {
        requirement: "policy-ready",
        name: "policy",
        status: "missing",
        detail: "no row",
      },
    ],
  } as unknown as ReadinessEvidence;

  expect(readinessFailureSummary(evidence)).toBe(
    "gateway-ready: gateway (crashloop), policy-ready: policy (no row)",
  );
});

test("the evidence object is a ConfigMap labelled with the generation and carrying the evidence as JSON", () => {
  const evidence = {
    generation: "gen-7",
    state: "open",
  } as unknown as ReadinessEvidence;

  expect(readinessEvidenceObject(evidence)).toEqual({
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: "kore-platform-readiness",
      namespace: "kore-system",
      labels: {
        "app.kubernetes.io/managed-by": "kore-bootstrap",
        "platform.kore.dev/generation": "gen-7",
      },
    },
    data: { "evidence.json": JSON.stringify(evidence) },
  });
});

test("the evidence is applied server-side under the gate's field manager, forcing conflicts, from stdin", async () => {
  const run = vi.fn<Run>(async () => ({ stdout: "", stderr: "", code: 0 }));
  const evidence = {
    generation: "gen-7",
    state: "open",
  } as unknown as ReadinessEvidence;

  await recordReadinessEvidence(
    manifest,
    { run } as unknown as Runner,
    evidence,
  );

  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "apply",
      "--server-side",
      `--field-manager=${admissionGateFieldManager}`,
      "--force-conflicts",
      "--filename=-",
    ],
    {
      capture: true,
      input: JSON.stringify(readinessEvidenceObject(evidence)),
    },
  );
});

test("a failed evidence write is reported through the warning, naming the ConfigMap, and not thrown", async () => {
  const warn = vi.fn<(message: string) => void>();
  const run = vi.fn<Run>(async () => {
    throw new CommandError("kubectl", [], {
      stdout: "",
      stderr: "namespaces kore-system not found",
      code: 1,
    });
  });

  await tryRecordReadinessEvidence(
    manifest,
    { run } as unknown as Runner,
    { generation: "gen-7" } as unknown as ReadinessEvidence,
    warn,
  );

  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]?.[0]).toMatch(
    /^could not record readiness evidence in kore-system\/kore-platform-readiness: /,
  );
});

test("a successful evidence write is not warned about", async () => {
  const warn = vi.fn<(message: string) => void>();
  const run = vi.fn<Run>(async () => ({ stdout: "", stderr: "", code: 0 }));

  await tryRecordReadinessEvidence(
    manifest,
    { run } as unknown as Runner,
    { generation: "gen-7" } as unknown as ReadinessEvidence,
    warn,
  );

  expect(warn).not.toHaveBeenCalled();
});

test("an error that is not a command failure is rethrown, not swallowed as a warning", async () => {
  const warn = vi.fn<(message: string) => void>();
  const run = vi.fn<Run>(async () => {
    throw new TypeError("evidence is not serialisable");
  });

  await expect(
    tryRecordReadinessEvidence(
      manifest,
      { run } as unknown as Runner,
      { generation: "gen-7" } as unknown as ReadinessEvidence,
      warn,
    ),
  ).rejects.toThrow(TypeError);

  expect(warn).not.toHaveBeenCalled();
});
