// Docs: docs/decisions/0138-publish-signed-configuration-charts-from-main-for-local-proofs.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import { outcomeSection } from "../idea/index.js";
import { fakeRepository, type FakeIdea } from "./flag-support.js";
import { activationProof, findProof } from "./proof.js";
import { readProofLock, type ProofLock } from "./recorded-lock.js";
import { chartDifferences } from "./release-lock.js";

vi.mock("../idea/index.js");
vi.mock("./recorded-lock.js");
vi.mock("./release-lock.js");

const FLAG = "ingress-agentgateway";
const ENVIRONMENT = "local";

const proven: Record<string, string> = {
  Result: "confirmed",
  Kind: "verification",
  Source: "live-run",
  Flag: FLAG,
  Environment: ENVIRONMENT,
};

/** An outcome section as the tool writes it: the heading, a blank line, then the field lines. */
function section(fields: Record<string, string>, after = ""): string {
  return [
    "## Outcome",
    "",
    ...Object.entries(fields).map(([key, value]) => `- ${key}: ${value}`),
    after,
  ].join("\n");
}

const idea = (number: string, body: string): FakeIdea => ({
  number,
  path: `docs/ideas/${number}-proof.md`,
  text: body,
});

beforeEach(() => {
  // The real section reader: the text from `## Outcome` on, or undefined when there is none.
  vi.mocked(outcomeSection).mockImplementation((text) =>
    text === "" ? undefined : text,
  );
});

const CHART = {
  name: "cilium",
  version: "1.0.0",
  digest: `sha256:${"a".repeat(64)}`,
};
const RELEASE = { cilium: { version: "1.0.0", digest: CHART.digest } };

/** The lock each fake outcome states, keyed by the `Lock` field the spec writes. */
const locks: Record<string, ProofLock> = {
  none: { kind: "none" },
  release: { kind: "release" },
  main: { kind: "main", charts: [CHART] },
  "main-bad": { kind: "main", charts: [{ ...CHART, version: "9.9.9" }] },
  invalid: {
    kind: "invalid",
    reason: "its lock is main but it records no charts",
  },
};

/** A live-run outcome that states the lock named by `lock`. */
const locked = (number: string, lock: string, source = "live-run") =>
  idea(number, section({ ...proven, Source: source, Lock: lock }));

beforeEach(() => {
  vi.mocked(readProofLock).mockImplementation(
    (fields) => locks[fields.get("Lock") ?? "none"] ?? { kind: "none" },
  );
  // A chart recorded at 9.9.9 differs from the release lock; any other matches.
  vi.mocked(chartDifferences).mockImplementation((charts) =>
    charts.some((c) => c.version === "9.9.9")
      ? ["cilium (version 9.9.9, release lock 1.0.0)"]
      : [],
  );
});

describe("activationProof counting a main-lock proof", () => {
  it("counts a main-lock live run whose charts equal the release lock", async () => {
    const repo = fakeRepository([locked("0001", "main")]);
    expect(await activationProof(repo, FLAG, ENVIRONMENT, RELEASE)).toEqual({
      proof: {
        idea: "0001",
        path: "docs/ideas/0001-proof.md",
        source: "live-run",
      },
      refused: [],
    });
    expect(chartDifferences).toHaveBeenCalledWith([CHART], RELEASE);
  });

  it("refuses a main-lock live run that differs, and names the differing charts and the idea", async () => {
    const repo = fakeRepository([locked("0001", "main-bad")]);
    expect(await activationProof(repo, FLAG, ENVIRONMENT, RELEASE)).toEqual({
      proof: undefined,
      refused: [
        "docs/ideas/0001-proof.md: its main-lock charts differ from the release lock: cilium (version 9.9.9, release lock 1.0.0)",
      ],
    });
  });

  it("refuses a main-lock proof when no release lock is given, saying to pass one", async () => {
    const repo = fakeRepository([locked("0001", "main")]);
    expect(await activationProof(repo, FLAG, ENVIRONMENT, undefined)).toEqual({
      proof: undefined,
      refused: [
        "docs/ideas/0001-proof.md: it is a main-lock proof, so activation compares it with the release chart lock; pass --chart-lock <platform-charts.lock.json> of the release",
      ],
    });
    expect(chartDifferences).not.toHaveBeenCalled();
  });

  it("refuses an outcome whose lock is partial, naming why, instead of reading it as no lock", async () => {
    const repo = fakeRepository([locked("0001", "invalid")]);
    expect(await activationProof(repo, FLAG, ENVIRONMENT, RELEASE)).toEqual({
      proof: undefined,
      refused: [
        "docs/ideas/0001-proof.md: its lock is main but it records no charts",
      ],
    });
  });

  it("refuses a partial lock even when no release lock is given", async () => {
    const repo = fakeRepository([locked("0001", "invalid")]);
    const found = await activationProof(repo, FLAG, ENVIRONMENT, undefined);
    expect(found.proof).toBeUndefined();
    expect(found.refused).toHaveLength(1);
  });
});

describe("activationProof outcomes that behave as before", () => {
  it.each([
    ["states no lock", "none"],
    ["states a release lock", "release"],
  ])("counts a live run that %s, without comparing charts", async (_, lock) => {
    const repo = fakeRepository([locked("0001", lock)]);
    expect(await activationProof(repo, FLAG, ENVIRONMENT, undefined)).toEqual({
      proof: {
        idea: "0001",
        path: "docs/ideas/0001-proof.md",
        source: "live-run",
      },
      refused: [],
    });
    expect(chartDifferences).not.toHaveBeenCalled();
  });

  it("counts an owner waiver without reading its lock", async () => {
    const repo = fakeRepository([locked("0001", "main-bad", "owner-waiver")]);
    expect(await activationProof(repo, FLAG, ENVIRONMENT, RELEASE)).toEqual({
      proof: {
        idea: "0001",
        path: "docs/ideas/0001-proof.md",
        source: "owner-waiver",
      },
      refused: [],
    });
    expect(readProofLock).not.toHaveBeenCalled();
  });

  it("finds no proof and no refusal when no outcome matches", async () => {
    const repo = fakeRepository([idea("0001", "")]);
    expect(await activationProof(repo, FLAG, ENVIRONMENT, RELEASE)).toEqual({
      proof: undefined,
      refused: [],
    });
  });
});

describe("activationProof choosing among outcomes", () => {
  it("prefers a later valid live run over an earlier refused one, and reports no refusal", async () => {
    const repo = fakeRepository([
      locked("0001", "main-bad"),
      locked("0002", "main"),
    ]);
    expect(await activationProof(repo, FLAG, ENVIRONMENT, RELEASE)).toEqual({
      proof: {
        idea: "0002",
        path: "docs/ideas/0002-proof.md",
        source: "live-run",
      },
      refused: [],
    });
  });

  it("falls back to an owner waiver when the live run is refused, and reports no refusal", async () => {
    const repo = fakeRepository([
      locked("0001", "main-bad"),
      locked("0002", "none", "owner-waiver"),
    ]);
    expect(await activationProof(repo, FLAG, ENVIRONMENT, RELEASE)).toEqual({
      proof: {
        idea: "0002",
        path: "docs/ideas/0002-proof.md",
        source: "owner-waiver",
      },
      refused: [],
    });
  });

  it("keeps the live run over an owner waiver recorded before it", async () => {
    const repo = fakeRepository([
      locked("0001", "none", "owner-waiver"),
      locked("0002", "main"),
    ]);
    expect(
      await activationProof(repo, FLAG, ENVIRONMENT, RELEASE),
    ).toMatchObject({
      proof: { idea: "0002", source: "live-run" },
    });
  });

  it("lists every refused outcome when none counts", async () => {
    const repo = fakeRepository([
      locked("0001", "main-bad"),
      locked("0002", "invalid"),
    ]);
    const found = await activationProof(repo, FLAG, ENVIRONMENT, RELEASE);
    expect(found.proof).toBeUndefined();
    expect(found.refused.map((r) => r.slice(0, 28))).toEqual([
      "docs/ideas/0001-proof.md: it",
      "docs/ideas/0002-proof.md: it",
    ]);
  });

  it("does not report a refusal for an outcome of another flag", async () => {
    const other = idea(
      "0001",
      section({ ...proven, Flag: "other-flag", Lock: "main-bad" }),
    );
    const found = await activationProof(
      fakeRepository([other]),
      FLAG,
      ENVIRONMENT,
      RELEASE,
    );
    expect(found).toEqual({ proof: undefined, refused: [] });
  });
});

describe("findProof does not compare charts", () => {
  it("counts a live run whatever lock it states, because the audit has no release lock", async () => {
    const repo = fakeRepository([locked("0001", "main-bad")]);
    expect(await findProof(repo, FLAG, ENVIRONMENT)).toMatchObject({
      idea: "0001",
    });
    expect(readProofLock).not.toHaveBeenCalled();
  });
});
