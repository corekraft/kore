// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clock } from "../runtime/index.js";
import { errno, fakeFileSystem } from "./flag-support.js";
import { FlagError } from "./overlay.js";
import {
  renderWindow,
  validateWindow,
  windowPath,
  type AppWindow,
} from "./app-window-record.js";
import {
  recordAppFlagWindow,
  type AppWindowInput,
} from "./app-window-writer.js";

vi.mock("./app-window-record.js");

const ROOT = "/repo";
const NOW = new Date("2026-11-24T09:00:00.000Z");
const PATH = "infra/app-outcomes/local/leads.new-checkout/window.json";

const INPUT: AppWindowInput = {
  result: "confirmed",
  app: "leads",
  flag: "leads.new-checkout",
  environment: "local",
  digest: `sha256:${"a".repeat(64)}`,
  commit: "b".repeat(40),
  window: {
    start: new Date("2026-11-23T10:00:00.000Z"),
    end: new Date("2026-11-23T11:00:00.000Z"),
  },
  evidence: "platform activation window over kube-state-metrics series",
  evidenceSet: ["availability", "restarts", "readiness"],
  series: [{ name: "kube_deployment_status_replicas_available", value: "3" }],
  summary: "Every evidence signal held for the whole window.",
};

const clock: Clock = { now: () => NOW, sleep: () => Promise.resolve() };

/**
 * A file system that keeps every record it is given, and refuses a create over
 * an existing path with EEXIST, as the real one does with its exclusive flag.
 */
function store(initial: Record<string, string> = {}) {
  const files: Record<string, string> = { ...initial };
  const fs = fakeFileSystem(files, {
    createFile: (path, content) => {
      if (path in files) {
        return Promise.reject(errno("EEXIST", `EEXIST: ${path}`));
      }
      files[path] = content;
      return Promise.resolve();
    },
  });
  return { fs, files };
}

/** The window the record module is asked to validate and render, as the writer builds it. */
function asked(): AppWindow {
  return vi.mocked(renderWindow).mock.calls[0]?.[0] as AppWindow;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(validateWindow).mockImplementation((value) => value as AppWindow);
  vi.mocked(windowPath).mockReturnValue(PATH);
  vi.mocked(renderWindow).mockReturnValue("RECORD\n");
});

describe("recordAppFlagWindow writes one window record", () => {
  it("writes the rendered record at the window's path and returns that repository path", async () => {
    const { fs, files } = store();
    const path = await recordAppFlagWindow({ root: ROOT, fs, clock }, INPUT);
    expect(path).toBe(PATH);
    expect(files[`${ROOT}/${PATH}`]).toBe("RECORD\n");
  });

  it("carries every field of the outcome into the record, with the platform's kind and source", async () => {
    const { fs } = store();
    await recordAppFlagWindow({ root: ROOT, fs, clock }, INPUT);
    expect(asked()).toEqual({
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
        { name: "kube_deployment_status_replicas_available", value: "3" },
      ],
      summary: "Every evidence signal held for the whole window.",
      recorded: "2026-11-24",
    });
  });

  it("dates the record by the clock, in UTC, as the harness outcome does", async () => {
    const late = new Date("2026-11-24T23:30:00.000Z");
    const { fs } = store();
    await recordAppFlagWindow(
      { root: ROOT, fs, clock: { ...clock, now: () => late } },
      INPUT,
    );
    expect(asked().recorded).toBe("2026-11-24");
  });

  it("keys the path by the window, so the record's path is the one windowPath gives", async () => {
    const { fs } = store();
    await recordAppFlagWindow({ root: ROOT, fs, clock }, INPUT);
    expect(vi.mocked(windowPath)).toHaveBeenCalledWith(asked());
  });
});

describe("recordAppFlagWindow refuses a second write for the same window", () => {
  it("refuses it, naming the window, and leaves the first record as it was", async () => {
    const { fs, files } = store({ [`${ROOT}/${PATH}`]: "FIRST\n" });
    await expect(
      recordAppFlagWindow({ root: ROOT, fs, clock }, INPUT),
    ).rejects.toThrow(
      new FlagError(
        `${PATH} already holds the app flag window for leads.new-checkout in local from 2026-11-23T10:00:00.000Z to 2026-11-23T11:00:00.000Z; a window is recorded once, so this write is refused and the record is unchanged. Record a window with its own start and end.`,
      ),
    );
    expect(files[`${ROOT}/${PATH}`]).toBe("FIRST\n");
  });

  it("writes a record for a different window of the same flag and environment", async () => {
    const { fs } = store({ [`${ROOT}/${PATH}`]: "FIRST\n" });
    vi.mocked(windowPath).mockReturnValue(
      "infra/app-outcomes/local/leads.new-checkout/other.json",
    );
    await expect(
      recordAppFlagWindow({ root: ROOT, fs, clock }, INPUT),
    ).resolves.toBe("infra/app-outcomes/local/leads.new-checkout/other.json");
  });
});

describe("recordAppFlagWindow refuses what it cannot record, writing nothing", () => {
  it("refuses a window the record rules reject, before any write", async () => {
    vi.mocked(validateWindow).mockImplementation(() => {
      throw new FlagError("the app flag window: result must be one of");
    });
    const { fs, files } = store();
    await expect(
      recordAppFlagWindow({ root: ROOT, fs, clock }, INPUT),
    ).rejects.toThrow("result must be one of");
    expect(files).toEqual({});
  });

  it("refuses a window whose start is not a time, naming the window", async () => {
    const { fs, files } = store();
    await expect(
      recordAppFlagWindow(
        {
          root: ROOT,
          fs,
          clock,
        },
        {
          ...INPUT,
          window: { start: new Date("nope"), end: INPUT.window.end },
        },
      ),
    ).rejects.toThrow("the window start is not a valid time");
    expect(files).toEqual({});
  });

  it("rethrows a file system failure that is not a refusal of an existing record", async () => {
    const fs = fakeFileSystem(
      {},
      {
        createFile: () => Promise.reject(errno("EACCES", "EACCES: denied")),
      },
    );
    await expect(
      recordAppFlagWindow({ root: ROOT, fs, clock }, INPUT),
    ).rejects.toThrow("EACCES: denied");
  });
});
