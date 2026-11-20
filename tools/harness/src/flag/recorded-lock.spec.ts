// Docs: docs/decisions/0138-publish-signed-configuration-charts-from-main-for-local-proofs.md
import { describe, expect, it } from "vitest";
import { parseCharts, readProofLock, renderCharts } from "./recorded-lock.js";

const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;

const cilium = { name: "cilium", version: "1.17.0-abc123", digest: A };
const gateway = { name: "gateway", version: "0.2.0+build.7", digest: B };

describe("renderCharts", () => {
  it("writes each chart as name=version@digest on one line, separated by a semicolon and a space", () => {
    expect(renderCharts([cilium, gateway])).toBe(
      `cilium=1.17.0-abc123@${A}; gateway=0.2.0+build.7@${B}`,
    );
  });
});

describe("parseCharts accepted input", () => {
  it("reads back what renderCharts wrote", () => {
    expect(parseCharts(renderCharts([cilium, gateway]))).toEqual({
      charts: [cilium, gateway],
    });
  });

  it("trims the whitespace around each chart", () => {
    expect(
      parseCharts(`  cilium=1.17.0-abc123@${A} ; gateway=0.2.0+build.7@${B}  `),
    ).toEqual({ charts: [cilium, gateway] });
  });
});

describe("parseCharts refusals", () => {
  it.each([
    ["an empty list", ""],
    ["a blank list", "   "],
  ])(
    "refuses %s, so a lock kind with no charts is not read as no lock",
    (_, text) => {
      expect(parseCharts(text)).toEqual({
        error:
          "no charts are recorded; name each as <name>=<version>@sha256:<64 hex>",
      });
    },
  );

  it.each([
    ["a digest missing", "cilium=1.17.0"],
    ["a digest that is a tag", "cilium=1.17.0@latest"],
    ["a short digest", "cilium=1.17.0@sha256:abc"],
    ["a version missing", `cilium=@${A}`],
    ["a name missing", `=1.0.0@${A}`],
    ["an empty entry after a semicolon", `cilium=1.0.0@${A};`],
  ])("refuses %s, naming the entry", (_, text) => {
    const result = parseCharts(text);
    expect(result).toHaveProperty("error");
    expect(result).not.toHaveProperty("charts");
  });

  it("names the entry that is malformed", () => {
    expect(parseCharts(`cilium=1.17.0@${A}; gateway=0.2.0`)).toEqual({
      error:
        '"gateway=0.2.0" is not <name>=<version>@sha256:<64 hex>; record the chart\'s version and digest from the lock',
    });
  });

  it("refuses a chart listed twice, because the later entry could hide the first", () => {
    expect(parseCharts(`cilium=1.0.0@${A}; cilium=1.0.0@${B}`)).toEqual({
      error: "chart cilium is listed twice",
    });
  });
});

describe("readProofLock", () => {
  const fields = (entries: Record<string, string>) =>
    new Map(Object.entries(entries));

  it("reads an outcome with no lock field and no charts as no lock, so old outcomes behave as before", () => {
    expect(readProofLock(fields({ Result: "confirmed" }))).toEqual({
      kind: "none",
    });
  });

  it("reads a release lock as a release lock", () => {
    expect(
      readProofLock(
        fields({ Lock: "release", Charts: renderCharts([cilium]) }),
      ),
    ).toEqual({ kind: "release" });
  });

  it("reads a main lock with its recorded charts", () => {
    expect(
      readProofLock(fields({ Lock: "main", Charts: renderCharts([cilium]) })),
    ).toEqual({ kind: "main", charts: [cilium] });
  });

  it("refuses a main lock with no Charts line, never reading it as no lock", () => {
    expect(readProofLock(fields({ Lock: "main" }))).toEqual({
      kind: "invalid",
      reason: "its lock is main but it records no charts",
    });
  });

  it("refuses a main lock whose charts are empty", () => {
    expect(readProofLock(fields({ Lock: "main", Charts: "" }))).toEqual({
      kind: "invalid",
      reason:
        "its recorded charts are unusable: no charts are recorded; name each as <name>=<version>@sha256:<64 hex>",
    });
  });

  it("refuses a main lock with a chart that has no digest", () => {
    expect(
      readProofLock(fields({ Lock: "main", Charts: "cilium=1.17.0" })),
    ).toEqual({
      kind: "invalid",
      reason:
        'its recorded charts are unusable: "cilium=1.17.0" is not <name>=<version>@sha256:<64 hex>; record the chart\'s version and digest from the lock',
    });
  });

  it("refuses a lock kind that is neither main nor release, rather than reading it as no lock", () => {
    expect(
      readProofLock(
        fields({ Lock: "nightly", Charts: renderCharts([cilium]) }),
      ),
    ).toEqual({
      kind: "invalid",
      reason: 'its lock "nightly" is neither main nor release',
    });
  });

  it("refuses an empty lock kind", () => {
    expect(readProofLock(fields({ Lock: "" }))).toEqual({
      kind: "invalid",
      reason: 'its lock "" is neither main nor release',
    });
  });

  it("refuses recorded charts that state no lock kind", () => {
    expect(readProofLock(fields({ Charts: renderCharts([cilium]) }))).toEqual({
      kind: "invalid",
      reason: "it records charts but no lock kind",
    });
  });
});
