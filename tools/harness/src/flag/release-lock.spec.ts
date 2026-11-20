// Docs: docs/decisions/0138-publish-signed-configuration-charts-from-main-for-local-proofs.md
import { describe, expect, it } from "vitest";
import { FlagError } from "./overlay.js";
import { chartDifferences, parseReleaseLock } from "./release-lock.js";

const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;

const lockText = (entries: Record<string, unknown>) =>
  JSON.stringify({ version: 1, entries });

describe("parseReleaseLock", () => {
  it("reads each release's version and digest from the lock's entries", () => {
    expect(
      parseReleaseLock(
        lockText({
          cilium: { chart: "ghcr.io/k/cilium", digest: A, version: "1.0.0" },
          gateway: { chart: "ghcr.io/k/gateway", digest: B, version: "2.0.0" },
        }),
        "release.lock.json",
      ),
    ).toEqual({
      cilium: { version: "1.0.0", digest: A },
      gateway: { version: "2.0.0", digest: B },
    });
  });

  it.each([
    ["text that is not JSON", "not json"],
    ["a lock without entries", JSON.stringify({ version: 1 })],
    ["a lock of another version", JSON.stringify({ version: 2, entries: {} })],
    ["an entry without a version", lockText({ cilium: { digest: A } })],
    ["an entry without a digest", lockText({ cilium: { version: "1.0.0" } })],
  ])("refuses %s, naming the file and the fix", (_, text) => {
    expect(() => parseReleaseLock(text, "release.lock.json")).toThrow(
      new FlagError(
        "release.lock.json must be {version: 1, entries: {<release>: {chart, digest, version}}}; pass the platform-charts.lock.json attached to the release.",
      ),
    );
  });
});

describe("chartDifferences", () => {
  const release = {
    cilium: { version: "1.0.0", digest: A },
    gateway: { version: "2.0.0", digest: B },
  };

  it("finds no difference when every recorded chart has the release lock's version and digest", () => {
    expect(
      chartDifferences(
        [
          { name: "cilium", version: "1.0.0", digest: A },
          { name: "gateway", version: "2.0.0", digest: B },
        ],
        release,
      ),
    ).toEqual([]);
  });

  it("ignores a release chart the proof never recorded", () => {
    expect(
      chartDifferences(
        [{ name: "cilium", version: "1.0.0", digest: A }],
        release,
      ),
    ).toEqual([]);
  });

  it("names a chart whose digest differs, with both digests", () => {
    expect(
      chartDifferences(
        [{ name: "cilium", version: "1.0.0", digest: B }],
        release,
      ),
    ).toEqual([`cilium (digest ${B}, release lock ${A})`]);
  });

  it("names a chart whose version differs, with both versions", () => {
    expect(
      chartDifferences(
        [{ name: "cilium", version: "1.0.1", digest: A }],
        release,
      ),
    ).toEqual(["cilium (version 1.0.1, release lock 1.0.0)"]);
  });

  it("names both differences of one chart on one line", () => {
    expect(
      chartDifferences(
        [{ name: "cilium", version: "1.0.1", digest: B }],
        release,
      ),
    ).toEqual([
      `cilium (version 1.0.1, release lock 1.0.0; digest ${B}, release lock ${A})`,
    ]);
  });
});

describe("chartDifferences missing and several charts", () => {
  const release = {
    cilium: { version: "1.0.0", digest: A },
    gateway: { version: "2.0.0", digest: B },
  };

  it("names a recorded chart that the release lock does not have", () => {
    expect(
      chartDifferences(
        [{ name: "argocd", version: "1.0.0", digest: A }],
        release,
      ),
    ).toEqual(["argocd (not in the release lock)"]);
  });

  it("names every differing chart and not the matching one", () => {
    expect(
      chartDifferences(
        [
          { name: "cilium", version: "1.0.0", digest: A },
          { name: "gateway", version: "2.0.0", digest: A },
          { name: "argocd", version: "1.0.0", digest: A },
        ],
        release,
      ),
    ).toEqual([
      `gateway (digest ${A}, release lock ${B})`,
      "argocd (not in the release lock)",
    ]);
  });

  it("does not read a chart named like an object property as present", () => {
    expect(
      chartDifferences(
        [{ name: "constructor", version: "1.0.0", digest: A }],
        release,
      ),
    ).toEqual(["constructor (not in the release lock)"]);
  });
});
