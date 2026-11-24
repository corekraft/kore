import { describe, expect, it } from "vitest";
import type { Environment } from "../config/index.js";
import {
  externalDnsLogProblems,
  outcomeArgs,
  proofDomain,
  proofFlags,
  proofRoutes,
  proofRoutesManifest,
  throwawayEnvironment,
} from "./external-dns-proof.live.js";

function localWith(features: Record<string, boolean>): Environment {
  return {
    name: "local",
    provider: "k3d",
    features,
    platform: { domain: "kore.internal", organizationId: "platform" },
  } as unknown as Environment;
}

const overlayFeatures = {
  "platform-shared-gateway": true,
  "service-listener-sets": false,
  "external-gateway": false,
  "external-dns": false,
  "otlp-route": true,
};

const published = proofRoutes.published.hostname;
const outside = proofRoutes.outside.hostname;
const internal = proofRoutes.internal.hostname;

// external-dns's planned-change lines for the published name: its A record, and the TXT record that
// carries the ownership registry with the owner id kore-vps (ADR 0162).
const plannedLines = [
  `level=info msg="Desired change: CREATE ${published} A"`,
  `level=info msg="Desired change: CREATE ${published} TXT \\"heritage=external-dns,external-dns/owner=kore-vps,external-dns/resource=httproute/kore-system/external-dns-proof-app\\""`,
];

describe("the throwaway copy's environment", () => {
  it("turns on the external-dns chain and the example.com proof domain, leaving the other flags as the overlay has them", () => {
    const copy = throwawayEnvironment(localWith(overlayFeatures));

    expect(copy.features).toEqual({
      "platform-shared-gateway": true,
      "service-listener-sets": true,
      "external-gateway": true,
      "external-dns": true,
      "otlp-route": true,
    });
    expect(copy.platform).toEqual({
      domain: "example.com",
      organizationId: "platform",
    });
  });

  it("turns the flags on in dependency order, so each prerequisite is on before the flag that needs it", () => {
    expect(proofFlags).toEqual([
      "service-listener-sets",
      "external-gateway",
      "external-dns",
    ]);
  });

  it("does not change the environment it was given", () => {
    const original = localWith({ ...overlayFeatures });
    throwawayEnvironment(original);

    expect(original.features).toEqual(overlayFeatures);
    expect(original.platform.domain).toBe("kore.internal");
  });
});

describe("the proof's names", () => {
  it("uses example.com-style names only, never the local domain", () => {
    for (const hostname of [published, outside, internal]) {
      expect(hostname).not.toContain("kore.internal");
      expect(hostname).toMatch(/\.example\.(com|org)$/);
    }
  });

  it("places the published name inside the proof domain and the outside name outside it", () => {
    expect(published.endsWith(`.${proofDomain}`)).toBe(true);
    expect(outside.endsWith(`.${proofDomain}`)).toBe(false);
  });

  it("places the internal name under internal.<proof domain>", () => {
    expect(internal.endsWith(`.internal.${proofDomain}`)).toBe(true);
  });
});

describe("the proof routes", () => {
  it("renders one HTTPRoute per name in kore-system on the external Gateway's http listener", () => {
    const manifest = JSON.parse(proofRoutesManifest()) as {
      items: {
        metadata: { name: string; namespace: string };
        spec: { hostnames: string[]; parentRefs: unknown[] };
      }[];
    };

    expect(manifest.items.map((item) => item.spec.hostnames)).toEqual([
      [published],
      [outside],
      [internal],
    ]);
    for (const item of manifest.items) {
      expect(item.metadata.namespace).toBe("kore-system");
      expect(item.spec.parentRefs).toEqual([
        {
          group: "gateway.networking.k8s.io",
          kind: "Gateway",
          name: "kore-gateway-external",
          namespace: "kore-system",
          sectionName: "http",
        },
      ]);
    }
  });
});

describe("the external-dns log check", () => {
  it("passes when the published name has its planned A and ownership TXT, and the other names have no change", () => {
    expect(externalDnsLogProblems(plannedLines.join("\n"))).toEqual([]);
  });

  it("names the published name when no A change was planned for it", () => {
    const log = plannedLines.slice(1).join("\n");

    const problems = externalDnsLogProblems(log);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(published);
    expect(problems[0]).toContain("A");
  });

  it("names the published name when its ownership TXT is missing or carries another owner", () => {
    const otherOwner = plannedLines[1]?.replace("kore-vps", "someone-else");
    const log = [plannedLines[0], otherOwner].join("\n");

    const problems = externalDnsLogProblems(log);

    expect(problems.some((problem) => problem.includes(published))).toBe(true);
    expect(problems.join("\n")).toContain("owner");
  });

  it("names an outside or internal name that gets a planned change", () => {
    const log = [
      ...plannedLines,
      `level=info msg="Desired change: CREATE ${outside} A"`,
      `level=info msg="Desired change: CREATE ${internal} A"`,
    ].join("\n");

    const problems = externalDnsLogProblems(log);

    expect(problems.some((problem) => problem.includes(outside))).toBe(true);
    expect(problems.some((problem) => problem.includes(internal))).toBe(true);
  });

  it("does not count a line that only mentions an outside name without a change to it", () => {
    const log = [
      ...plannedLines,
      `level=debug msg="Skipping endpoint ${outside}: not in the domain filter"`,
    ].join("\n");

    expect(externalDnsLogProblems(log)).toEqual([]);
  });

  it("refuses any planned delete, since the policy is upsert-only (ADR 0162)", () => {
    const log = [
      ...plannedLines,
      `level=info msg="Desired change: DELETE ${published} A"`,
    ].join("\n");

    const problems = externalDnsLogProblems(log);

    expect(problems.join("\n")).toContain("DELETE");
    expect(problems.join("\n")).toContain("upsert-only");
  });
});

describe("the outcome record", () => {
  it("records a verification of external-dns in local from a live run, through outcome record", () => {
    expect(outcomeArgs("412", "external-dns live proof on abc1234")).toEqual([
      "outcome",
      "record",
      "--idea",
      "412",
      "--kind",
      "verification",
      "--source",
      "live-run",
      "--result",
      "confirmed",
      "--flag",
      "external-dns",
      "--environment",
      "local",
      "--evidence",
      "external-dns live proof on abc1234",
      "--summary",
      expect.stringContaining("Cloudflare read-back is not covered here"),
    ]);
  });

  it("states that the record-without-TXT check is not covered on the inmemory provider", () => {
    const args = outcomeArgs("412", "external-dns live proof on abc1234");

    expect(args[args.indexOf("--summary") + 1]).toContain(
      "not covered on the inmemory provider",
    );
  });

  it("refuses evidence that is not one line, or that holds an HTML comment, since outcome record refuses it", () => {
    expect(() => outcomeArgs("412", "line one\nline two")).toThrow(/evidence/);
    expect(() => outcomeArgs("412", "run <!-- hidden -->")).toThrow(/evidence/);
  });

  it("refuses an idea that is empty, since the outcome needs one", () => {
    expect(() => outcomeArgs("  ", "external-dns live proof")).toThrow(/idea/);
  });
});
