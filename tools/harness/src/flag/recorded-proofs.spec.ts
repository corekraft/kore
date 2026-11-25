// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import { outcomeSection } from "../idea/index.js";
import { fakeRepository, type FakeIdea } from "./flag-support.js";
import { recordedProofs } from "./proof.js";
import { readProofLock, type ProofLock } from "./recorded-lock.js";
import { chartDifferences, type ReleaseLock } from "./release-lock.js";

vi.mock("../idea/index.js");
vi.mock("./recorded-lock.js");
vi.mock("./release-lock.js");

const ENVIRONMENT = "vps";
const RELEASE: ReleaseLock = {
  cilium: { version: "1.0.0", digest: "sha256:aa" },
};
const CHART = { name: "cilium", version: "9.9.9", digest: "sha256:bb" };

/** The lock each fake outcome states, keyed by the `Lock` field the spec writes. */
const locks: Record<string, ProofLock> = {
  main: { kind: "main", charts: [CHART] },
  none: { kind: "none" },
};

/** An outcome section as the tool writes it: the heading, a blank line, then the field lines. */
function section(fields: Record<string, string>): string {
  return [
    "## Outcome",
    "",
    ...Object.entries(fields).map(([key, value]) => `- ${key}: ${value}`),
  ].join("\n");
}

/** A confirmed verification of a flag in the vps environment, from the given source and lock. */
const outcome = (
  flag: string,
  source: "live-run" | "owner-waiver",
  lock = "none",
) =>
  section({
    Result: "confirmed",
    Kind: "verification",
    Source: source,
    Flag: flag,
    Environment: ENVIRONMENT,
    Lock: lock,
  });

const idea = (number: string, body: string | undefined): FakeIdea => ({
  number,
  path: `docs/ideas/${number}-proof.md`,
  text: body ?? "",
});

beforeEach(() => {
  vi.mocked(outcomeSection).mockImplementation((text) =>
    text === "" ? undefined : text,
  );
  vi.mocked(readProofLock).mockImplementation(
    (fields) => locks[fields.get("Lock") ?? "none"] ?? { kind: "none" },
  );
  // A chart recorded at 9.9.9 differs from the release lock; any other matches.
  vi.mocked(chartDifferences).mockImplementation((charts) =>
    charts.some((c) => c.version === "9.9.9") ? ["cilium"] : [],
  );
});

describe("recordedProofs keeps one proof per flag", () => {
  it("keys each flag's counting live run by flag, with the idea that holds it", async () => {
    const repo = fakeRepository([
      idea("0001", outcome("platform-shared-gateway", "live-run")),
      idea("0002", outcome("in-cluster-ca", "live-run")),
    ]);
    const found = await recordedProofs(repo, ENVIRONMENT, undefined);
    expect([...found.entries()]).toEqual([
      [
        "platform-shared-gateway",
        {
          idea: "0001",
          path: "docs/ideas/0001-proof.md",
          source: "live-run",
        },
      ],
      [
        "in-cluster-ca",
        {
          idea: "0002",
          path: "docs/ideas/0002-proof.md",
          source: "live-run",
        },
      ],
    ]);
  });

  it("prefers a live run over an owner waiver for the same flag, whichever comes first", async () => {
    const waiverFirst = fakeRepository([
      idea("0001", outcome("in-cluster-ca", "owner-waiver")),
      idea("0002", outcome("in-cluster-ca", "live-run")),
    ]);
    const liveFirst = fakeRepository([
      idea("0001", outcome("in-cluster-ca", "live-run")),
      idea("0002", outcome("in-cluster-ca", "owner-waiver")),
    ]);
    expect(
      (await recordedProofs(waiverFirst, ENVIRONMENT, undefined)).get(
        "in-cluster-ca",
      ),
    ).toEqual({
      idea: "0002",
      path: "docs/ideas/0002-proof.md",
      source: "live-run",
    });
    expect(
      (await recordedProofs(liveFirst, ENVIRONMENT, undefined)).get(
        "in-cluster-ca",
      ),
    ).toEqual({
      idea: "0001",
      path: "docs/ideas/0001-proof.md",
      source: "live-run",
    });
  });
});

describe("recordedProofs applies activation's rules", () => {
  it("keeps an owner waiver for a flag with no counting live run in a local environment (ADR 0127)", async () => {
    const repo = fakeRepository([
      idea("0001", outcome("in-cluster-ca", "owner-waiver")),
    ]);
    expect([
      ...(await recordedProofs(repo, ENVIRONMENT, undefined)).entries(),
    ]).toEqual([
      [
        "in-cluster-ca",
        {
          idea: "0001",
          path: "docs/ideas/0001-proof.md",
          source: "owner-waiver",
        },
      ],
    ]);
  });

  it("keeps no owner waiver in a production environment, so the flag has no proof (ADR 0147)", async () => {
    const repo = fakeRepository([
      idea("0001", outcome("in-cluster-ca", "owner-waiver")),
    ]);
    expect(
      (await recordedProofs(repo, ENVIRONMENT, undefined, true)).size,
    ).toBe(0);
  });

  it("does not count a main-lock live run without a release lock, and keeps the waiver beside it outside production", async () => {
    const repo = fakeRepository([
      idea("0001", outcome("in-cluster-ca", "live-run", "main")),
      idea("0002", outcome("in-cluster-ca", "owner-waiver")),
    ]);
    expect(
      (await recordedProofs(repo, ENVIRONMENT, undefined)).get("in-cluster-ca"),
    ).toEqual({
      idea: "0002",
      path: "docs/ideas/0002-proof.md",
      source: "owner-waiver",
    });
  });

  it("counts a main-lock live run whose charts equal the release lock, and compares them", async () => {
    const repo = fakeRepository([
      idea("0001", outcome("in-cluster-ca", "live-run", "main")),
    ]);
    vi.mocked(chartDifferences).mockReturnValue([]);
    expect(
      (await recordedProofs(repo, ENVIRONMENT, RELEASE)).get("in-cluster-ca"),
    ).toEqual({
      idea: "0001",
      path: "docs/ideas/0001-proof.md",
      source: "live-run",
    });
    expect(chartDifferences).toHaveBeenCalledWith([CHART], RELEASE);
  });

  it("refuses a main-lock live run whose charts differ, leaving no proof in production", async () => {
    const repo = fakeRepository([
      idea("0001", outcome("in-cluster-ca", "live-run", "main")),
    ]);
    expect((await recordedProofs(repo, ENVIRONMENT, RELEASE, true)).size).toBe(
      0,
    );
  });
});

describe("recordedProofs reads only the outcomes that match", () => {
  it("ignores an outcome for another flag or environment, a refuted result, and an idea with no outcome", async () => {
    const repo = fakeRepository([
      idea("0001", undefined),
      idea("0002", outcome("other-flag", "live-run")),
      idea(
        "0003",
        section({
          Result: "refuted",
          Kind: "verification",
          Source: "live-run",
          Flag: "in-cluster-ca",
          Environment: ENVIRONMENT,
          Lock: "none",
        }),
      ),
      idea(
        "0004",
        section({
          Result: "confirmed",
          Kind: "verification",
          Source: "live-run",
          Flag: "in-cluster-ca",
          Environment: "local",
          Lock: "none",
        }),
      ),
    ]);
    expect((await recordedProofs(repo, ENVIRONMENT, undefined)).size).toBe(1);
  });
});
