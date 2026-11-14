import { describe, expect, it } from "vitest";
import { assess, clusterFacing } from "./verdict.js";
import { file } from "./tooling.fixtures.js";

// The hints are given as data: assess compares them to the pattern, it does not build them.
const clean = { patternMatches: true, clusterFacing: false, unverified: [] };

describe("assess: a hint that contradicts the pattern fails it", () => {
  it("no-behaviour-change with a behavioural path is a mismatch naming the path", () => {
    const hints = {
      behaviouralPaths: ["tools/kore/src/a.ts"],
      noBehaviouralDiff: false,
    };
    expect(
      assess("no-behaviour-change", hints, [file("tools/kore/src/a.ts")]),
    ).toMatchObject({
      patternMatches: false,
      patternMismatch:
        "no-behaviour-change, but the diff changes behaviour in: tools/kore/src/a.ts",
    });
  });

  it("feature-flagged without a flag present and off is a mismatch", () => {
    expect(
      assess("feature-flagged", { flagPresentAndOff: false }, []),
    ).toMatchObject({
      patternMatches: false,
      patternMismatch:
        "feature-flagged, but the diff adds no flag that is off in an environment overlay",
    });
  });

  it("dark-launched is a mismatch unless the flag is on only in local", () => {
    expect(
      assess("dark-launched", { flagOnlyInLocal: false }, []).patternMismatch,
    ).toBe(
      "dark-launched, but the diff adds no flag that is on only in the local overlay",
    );
  });

  it("branch-by-abstraction is a mismatch naming each deleted file", () => {
    expect(
      assess(
        "branch-by-abstraction",
        { oldPathRetained: false, deletedFiles: ["old.ts", "legacy.ts"] },
        [],
      ).patternMismatch,
    ).toBe(
      "branch-by-abstraction, but the diff deletes the old path: old.ts, legacy.ts",
    );
  });

  it("expand-contract is a mismatch that counts removed lines and deleted files", () => {
    expect(
      assess(
        "expand-contract",
        { additiveOnly: false, netRemovedLines: 2, deletedFiles: ["old.ts"] },
        [],
      ),
    ).toMatchObject({
      patternMatches: false,
      patternMismatch:
        "expand-contract, but the diff removes 2 line(s) without replacing them and deletes 1 file(s); that is a contract step, declare it only once the expand step is proven",
    });
  });

  it("matching hints leave no mismatch reason", () => {
    const result = assess("feature-flagged", { flagPresentAndOff: true }, []);
    expect(result).toEqual({ ...clean, unverified: ["gating not verified"] });
    expect(result).not.toHaveProperty("patternMismatch");
  });
});

describe("assess: what the precheck cannot verify is listed", () => {
  it("lists gating as unverified for a flagged change", () => {
    expect(
      assess("feature-flagged", { flagPresentAndOff: true }, []).unverified,
    ).toEqual(["gating not verified"]);
  });

  it("requires a live run before merge for a cluster-facing no-behaviour-change", () => {
    const files = [file("apps/web/values.yaml")];
    expect(
      assess("no-behaviour-change", { noBehaviouralDiff: true }, files),
    ).toEqual({
      patternMatches: true,
      clusterFacing: true,
      unverified: [
        "behaviour equivalence not verified",
        "cluster-facing: live run required before merge",
      ],
    });
  });

  it("requires live proof before activation for other cluster-facing patterns", () => {
    const files = [file("infra/charts/x/values.yaml")];
    expect(
      assess("feature-flagged", { flagPresentAndOff: true }, files).unverified,
    ).toEqual([
      "gating not verified",
      "cluster-facing: live proof required before the flag turns on",
    ]);
  });
});

describe("clusterFacing", () => {
  it.each([
    "apps/web/deploy.yaml",
    "infra/environments/local/environment.yaml",
    "catalog/components.yaml",
    "tools/kore/charts/x/Chart.yaml",
  ])("treats %s as cluster-facing", (path) => {
    expect(clusterFacing([file(path)])).toBe(true);
  });

  it.each([
    "infra/plans/11-agent-delivery-loop.md",
    "docs/index.md",
    "tools/harness/src/judge/hints.ts",
  ])("does not treat %s as cluster-facing", (path) => {
    expect(clusterFacing([file(path)])).toBe(false);
  });

  it("is cluster-facing when a cluster file is moved out of the cluster paths", () => {
    expect(
      clusterFacing([file("skills/values.yaml", [], "apps/web/values.yaml")]),
    ).toBe(true);
  });

  it("is not cluster-facing when a file moves between non-cluster paths", () => {
    expect(clusterFacing([file("docs/b.md", [], "tools/harness/a.ts")])).toBe(
      false,
    );
  });
});
