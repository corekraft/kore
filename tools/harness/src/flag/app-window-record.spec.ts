// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
import { describe, expect, it } from "vitest";
import { FlagError } from "./overlay.js";
import {
  APP_OUTCOMES_DIR,
  parseWindow,
  renderWindow,
  validateWindow,
  windowPath,
  type AppWindow,
} from "./app-window-record.js";

const WINDOW: AppWindow = {
  result: "confirmed",
  kind: "verification",
  source: "platform-window",
  app: "leads",
  flag: "leads.new-checkout",
  environment: "local",
  digest: `sha256:${"a".repeat(64)}`,
  commit: "b".repeat(40),
  window: {
    start: "2026-11-23T10:00:00.000Z",
    end: "2026-11-23T11:00:00.000Z",
  },
  evidence: "platform activation window over kube-state-metrics series",
  evidenceSet: ["availability", "restarts", "readiness"],
  series: [
    {
      name: 'kube_deployment_status_replicas_available{deployment="leads"}',
      value: "3",
    },
  ],
  summary: "Every evidence signal held for the whole window.",
  recorded: "2026-11-23",
};

const WHERE = "infra/app-outcomes/local/leads.new-checkout/window.json";

describe("validateWindow", () => {
  it("accepts a complete window and returns every field it was given", () => {
    expect(validateWindow(WINDOW, WHERE)).toEqual(WINDOW);
  });

  it.each(Object.keys(WINDOW))(
    "refuses a window with no %s, since every field is part of the outcome",
    (field) => {
      const value = { ...WINDOW, [field]: undefined };
      expect(() => validateWindow(value, WHERE)).toThrow(FlagError);
    },
  );
});

describe("validateWindow refuses a value outside the record's shape", () => {
  it("refuses a result outside the outcome vocabulary", () => {
    expect(() =>
      validateWindow({ ...WINDOW, result: "passed" }, WHERE),
    ).toThrow(/result must be one of confirmed, refuted, inconclusive/);
  });

  it("refuses any kind other than verification, the only kind an app flag takes", () => {
    expect(() =>
      validateWindow({ ...WINDOW, kind: "experiment" }, WHERE),
    ).toThrow(/kind must be "verification"/);
  });

  it("refuses any source other than platform-window, so a live run cannot pose as a window", () => {
    expect(() =>
      validateWindow({ ...WINDOW, source: "live-run" }, WHERE),
    ).toThrow(/source must be "platform-window"/);
  });

  it.each([
    ["app", "Leads"],
    ["app", "leads/x"],
    ["flag", "../leads"],
    ["flag", "leads/new"],
    ["environment", "local/../vps"],
    ["environment", ""],
  ])(
    "refuses a %s named %j, since the name becomes a path segment",
    (field, value) => {
      expect(() =>
        validateWindow({ ...WINDOW, [field]: value }, WHERE),
      ).toThrow(FlagError);
    },
  );
});

describe("validateWindow refuses a window, series or date it cannot read", () => {
  it("refuses a digest that is not a sha256 digest of 64 hex characters", () => {
    expect(() =>
      validateWindow({ ...WINDOW, digest: "sha256:abc" }, WHERE),
    ).toThrow(/digest must be sha256:<64 hex>/);
  });

  it("refuses a commit that is not a 40-character git commit", () => {
    expect(() => validateWindow({ ...WINDOW, commit: "b1c2" }, WHERE)).toThrow(
      /commit must be the app record's 40-character git commit/,
    );
  });

  it("refuses a window that ends before it starts, or whose bounds are not times", () => {
    const reversed = {
      ...WINDOW,
      window: { start: WINDOW.window.end, end: WINDOW.window.start },
    };
    expect(() => validateWindow(reversed, WHERE)).toThrow(/window must be/);
    expect(() =>
      validateWindow(
        { ...WINDOW, window: { start: "yesterday", end: "today" } },
        WHERE,
      ),
    ).toThrow(/window must be/);
  });

  it("refuses an outcome that quotes no series, so a verdict never rests on nothing", () => {
    expect(() => validateWindow({ ...WINDOW, series: [] }, WHERE)).toThrow(
      /series must quote each series by name and value/,
    );
    expect(() =>
      validateWindow({ ...WINDOW, series: [{ name: "up", value: "" }] }, WHERE),
    ).toThrow(/series must quote each series by name and value/);
  });

  it("refuses an evidence set that names no signal", () => {
    expect(() => validateWindow({ ...WINDOW, evidenceSet: [] }, WHERE)).toThrow(
      /evidenceSet must list the signals/,
    );
  });

  it("refuses a recorded date that is not YYYY-MM-DD", () => {
    expect(() =>
      validateWindow({ ...WINDOW, recorded: "23/11/2026" }, WHERE),
    ).toThrow(/recorded must be the YYYY-MM-DD date/);
  });

  it("names the record it refused, so the fix is findable", () => {
    expect(() =>
      validateWindow({ ...WINDOW, result: "passed" }, WHERE),
    ).toThrow(`${WHERE}: result must be one of`);
  });
});

describe("renderWindow and parseWindow", () => {
  it("writes a JSON record ending in a newline, and reads back every field unchanged", () => {
    const text = renderWindow(WINDOW);
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(WINDOW);
    expect(parseWindow(text, WHERE)).toEqual(WINDOW);
  });

  it("renders the same text for the same window, so a rerun writes the same bytes", () => {
    expect(renderWindow(WINDOW)).toBe(renderWindow({ ...WINDOW }));
  });

  it("refuses text that is not JSON, naming the record and saying the platform owns it", () => {
    expect(() => parseWindow("result: confirmed", WHERE)).toThrow(
      `${WHERE} is not JSON`,
    );
  });

  it("refuses a record a hand edit has broken, naming the record", () => {
    const edited = renderWindow(WINDOW).replace('"confirmed"', '"passed"');
    expect(() => parseWindow(edited, WHERE)).toThrow(
      `${WHERE}: result must be one of`,
    );
  });
});

describe("windowPath", () => {
  it("places a window under the one store, by environment, flag and its exact start and end", () => {
    expect(APP_OUTCOMES_DIR).toBe("infra/app-outcomes");
    expect(windowPath(WINDOW)).toBe(
      "infra/app-outcomes/local/leads.new-checkout/20261123T100000000Z_20261123T110000000Z.json",
    );
  });

  it("gives the same window the same path, and a different window a different one", () => {
    expect(windowPath(WINDOW)).toBe(windowPath({ ...WINDOW }));
    const later = {
      ...WINDOW,
      window: {
        start: "2026-11-23T10:00:00.500Z",
        end: "2026-11-23T11:00:00.000Z",
      },
    };
    expect(windowPath(later)).not.toBe(windowPath(WINDOW));
  });
});
