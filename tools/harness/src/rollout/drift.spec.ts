import { describe, expect, it } from "vitest";
import { compareRollout, parseChartRows } from "./drift.js";

const DIGEST = `sha256:${"c".repeat(64)}`;
const recorded = [
  { name: "cert-manager", version: "v1.19.1", digest: DIGEST },
  { name: "kore-local-tls", version: "0.0.0-abc123", digest: DIGEST },
];

const row = (release: string, name: string, version: string) => ({
  name: `chart:${release}`,
  status: "ready",
  chart: { name, version },
});

describe("parseChartRows", () => {
  it("keeps only the chart rows of kore platform status --json, with the chart each names", () => {
    const status = JSON.stringify([
      { name: "gateway", status: "ready" },
      row("cert-manager", "cert-manager", "v1.19.1"),
      { name: "chart:odd", status: "missing", detail: "release: not found" },
    ]);

    expect(parseChartRows(status)).toEqual([
      {
        release: "cert-manager",
        chart: { name: "cert-manager", version: "v1.19.1" },
      },
      { release: "odd", detail: "release: not found" },
    ]);
  });

  it.each(["{nope", "{}", "", "null"])(
    "refuses status text that is not a JSON list of rows: %j",
    (text) => {
      expect(() => parseChartRows(text)).toThrow("kore platform status");
    },
  );
});

describe("compareRollout", () => {
  it("reports no difference when each recorded chart's name and version are installed", () => {
    const rows = parseChartRows(
      JSON.stringify([
        row("cert-manager", "cert-manager", "v1.19.1"),
        row("kore-local-tls", "kore-local-tls", "0.0.0-abc123"),
      ]),
    );

    expect(compareRollout(recorded, rows)).toEqual({
      compared: 2,
      differences: [],
      notCompared: [],
    });
  });

  it("names each chart whose installed version or name differs from the record", () => {
    const rows = parseChartRows(
      JSON.stringify([
        row("cert-manager", "cert-manager", "v1.18.0"),
        row("kore-local-tls", "other-chart", "0.0.0-abc123"),
      ]),
    );

    expect(compareRollout(recorded, rows).differences).toEqual([
      "cert-manager: recorded version v1.19.1, installed v1.18.0",
      "kore-local-tls: recorded chart kore-local-tls, installed other-chart",
    ]);
  });

  it("names a chart helm could not read as a difference, with the cause", () => {
    const rows = parseChartRows(
      JSON.stringify([
        { name: "chart:cert-manager", status: "missing", detail: "no release" },
        row("kore-local-tls", "kore-local-tls", "0.0.0-abc123"),
      ]),
    );

    expect(compareRollout(recorded, rows)).toMatchObject({
      compared: 2,
      differences: [
        "cert-manager: recorded version v1.19.1, but the installed chart could not be read: no release",
      ],
    });
  });

  it("lists a recorded chart with no Helm release row as not compared, never as a match or a difference", () => {
    const rows = parseChartRows(
      JSON.stringify([row("cert-manager", "cert-manager", "v1.19.1")]),
    );

    expect(compareRollout(recorded, rows)).toEqual({
      compared: 1,
      differences: [],
      notCompared: [
        "kore-local-tls: no Helm release row in the status (a release Argo CD delivers has none)",
      ],
    });
  });

  it("ignores an installed release the lock does not record", () => {
    const rows = parseChartRows(
      JSON.stringify([
        row("cert-manager", "cert-manager", "v1.19.1"),
        row("kore-local-tls", "kore-local-tls", "0.0.0-abc123"),
        row("registry", "registry", "9.9.9"),
      ]),
    );

    expect(compareRollout(recorded, rows).differences).toEqual([]);
  });
});
