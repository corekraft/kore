// Docs: docs/decisions/0138-publish-signed-configuration-charts-from-main-for-local-proofs.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCharts, renderCharts } from "../flag/index.js";
import { IdeaError } from "../idea/index.js";
import { parseOutcome, renderSection } from "./model.js";
import { outcome } from "./outcome-support.js";

vi.mock("../flag/index.js");

const valid = {
  kind: "experiment",
  source: "comparison",
  result: "confirmed",
  evidence: "kore local up p50 41s before, 29s after",
  summary: "Up time fell from 41s to 29s.",
};

const CHART = {
  name: "cilium",
  version: "1.17.0-abc123",
  digest: `sha256:${"a".repeat(64)}`,
};

beforeEach(() => {
  vi.mocked(parseCharts).mockReturnValue({ charts: [CHART] });
  vi.mocked(renderCharts).mockReturnValue("RENDERED");
});

describe("parseOutcome chart lock", () => {
  const live = {
    ...valid,
    kind: "verification",
    source: "live-run",
    flag: "ingress-agentgateway",
    environment: "local",
  };

  it("carries no lock when neither --lock nor --charts is given, and reads no charts", () => {
    expect(parseOutcome(live)).not.toHaveProperty("lock");
    expect(parseCharts).not.toHaveBeenCalled();
  });

  it.each(["main", "release"])(
    "carries a %s lock and its parsed charts on a live flag verification",
    (kind) => {
      expect(
        parseOutcome({ ...live, lock: ` ${kind} `, charts: " LIST " }),
      ).toMatchObject({ lock: { kind, charts: [CHART] } });
      expect(parseCharts).toHaveBeenCalledWith("LIST");
    },
  );

  it("rejects --lock without --charts, naming the one it was given", () => {
    expect(() => parseOutcome({ ...live, lock: "main" })).toThrow(
      new IdeaError(
        "Missing --charts; a chart lock outcome names both --lock and --charts (got only --lock).",
      ),
    );
  });

  it("rejects --charts without --lock, so the charts are never recorded with no lock kind", () => {
    expect(() => parseOutcome({ ...live, charts: "LIST" })).toThrow(
      new IdeaError(
        "Missing --lock; a chart lock outcome names both --lock and --charts (got only --charts).",
      ),
    );
  });
});

describe("parseOutcome chart lock refusals", () => {
  const live = {
    ...valid,
    kind: "verification",
    source: "live-run",
    flag: "ingress-agentgateway",
    environment: "local",
  };

  it("rejects a lock kind that is neither main nor release", () => {
    expect(() =>
      parseOutcome({ ...live, lock: "nightly", charts: "LIST" }),
    ).toThrow(
      new IdeaError(
        '--lock "nightly" is not recognised; use one of main, release.',
      ),
    );
  });

  it("rejects charts that do not parse, with the reason and the fix", () => {
    vi.mocked(parseCharts).mockReturnValue({ error: "no charts are recorded" });
    expect(() =>
      parseOutcome({ ...live, lock: "main", charts: "BAD" }),
    ).toThrow(
      new IdeaError(
        "--charts is unusable: no charts are recorded; pass --charts <name>=<version>@sha256:<64 hex>[; ...] from the lock the proof ran on.",
      ),
    );
  });

  it("rejects a lock on an outcome that proves no flag", () => {
    expect(() =>
      parseOutcome({ ...valid, lock: "main", charts: "LIST" }),
    ).toThrow(
      new IdeaError(
        "--lock records the chart lock a flag proof ran on, so it needs --flag and --environment.",
      ),
    );
  });

  it("rejects a lock on an owner waiver, which ran nothing", () => {
    expect(() =>
      parseOutcome({
        ...live,
        source: "owner-waiver",
        evidence: "https://github.com/corekraft/kore/issues/1#issuecomment-2",
        lock: "main",
        charts: "LIST",
      }),
    ).toThrow(
      new IdeaError(
        "--lock needs --source live-run; an owner waiver ran no charts.",
      ),
    );
  });
});

describe("renderSection chart lock", () => {
  it("writes the lock kind and the rendered charts after the environment", () => {
    const locked = outcome({
      kind: "verification",
      source: "live-run",
      flag: { name: "ingress-agentgateway", environment: "local" },
      lock: { kind: "main", charts: [CHART] },
    });
    expect(renderSection(locked, "2026-11-14")).toBe(
      [
        "## Outcome",
        "",
        "- Result: confirmed",
        "- Kind: verification",
        "- Source: live-run",
        "- Flag: ingress-agentgateway",
        "- Environment: local",
        "- Lock: main",
        "- Charts: RENDERED",
        "- Evidence: kore local up p50 41s before, 29s after",
        "- Recorded: 2026-11-14",
        "",
        "Up time fell from 41s to 29s.",
      ].join("\n"),
    );
    expect(renderCharts).toHaveBeenCalledWith([CHART]);
  });
});
