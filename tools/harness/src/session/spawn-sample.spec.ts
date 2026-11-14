import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { mainRoot, type HostLoad } from "../runtime/index.js";
import { fakeDeps } from "./deps-support.js";
import { liveSessionCount } from "./live-sessions.js";
import { platformUp } from "./platform-up.js";
import { recordHostSample } from "./spawn-sample.js";

vi.mock("node:path");
const ledger = vi.hoisted(() => ({
  construct: vi.fn<(...args: unknown[]) => void>(),
  record: vi.fn<(event: object) => Promise<unknown>>(),
}));
vi.mock("../ledger/index.js", () => ({
  DEFAULT_LEDGER: ".kore/state/ledger.jsonl",
  Ledger: class {
    constructor(...args: unknown[]) {
      ledger.construct(...args);
    }
    record(event: object) {
      return ledger.record(event);
    }
  },
}));
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));
vi.mock("./live-sessions.js");
vi.mock("./platform-up.js");

const SPAWNED = { pane: "w3:p9", name: "image-writer" };
const LEDGER = "/main/.kore/state/ledger.jsonl";
const sample = vi.fn<HostLoad["sample"]>();
const hostLoad: HostLoad = { oneMinute: () => 0, sample };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
  vi.mocked(mainRoot).mockResolvedValue("/main");
  vi.mocked(liveSessionCount).mockResolvedValue(3);
  vi.mocked(platformUp).mockResolvedValue(true);
  sample.mockResolvedValue({ load: 3.25, memory: 0.4, swap: 2048 });
  ledger.record.mockResolvedValue({ ok: true });
});

const withHost = () => ({ ...fakeDeps(), hostLoad });

it("appends exactly one host-sample with the reading, the live count and the platform flag", async () => {
  const deps = withHost();

  await recordHostSample(deps, SPAWNED);

  expect(ledger.construct.mock.calls).toEqual([
    [deps.fs, deps.clock, deps.ids, LEDGER],
  ]);
  expect(ledger.record.mock.calls).toEqual([
    [
      {
        source: "herdr",
        kind: "host-sample",
        occurredAt: "2026-01-02T03:04:05.000Z",
        pane: "w3:p9",
        agent: "image-writer",
        load: 3.25,
        memory: 0.4,
        swap: 2048,
        sessions: 3,
        platform: true,
      },
    ],
  ]);
  expect(sample.mock.calls).toEqual([[deps.runner]]);
  expect(platformUp).toHaveBeenCalledWith(deps.fs, "/main");
});

it("leaves out a load the host could not report, since infinity is not storable", async () => {
  sample.mockResolvedValue({ load: Number.POSITIVE_INFINITY });

  await recordHostSample(withHost(), SPAWNED);

  expect(ledger.record.mock.calls).toEqual([
    [
      {
        source: "herdr",
        kind: "host-sample",
        occurredAt: "2026-01-02T03:04:05.000Z",
        pane: "w3:p9",
        agent: "image-writer",
        sessions: 3,
        platform: true,
      },
    ],
  ]);
});

it("records no event when the live count is unknown, never a guessed zero", async () => {
  vi.mocked(liveSessionCount).mockResolvedValue(undefined);

  await recordHostSample(withHost(), SPAWNED);

  expect(ledger.record).not.toHaveBeenCalled();
});

it("records nothing when no host reader is injected", async () => {
  await recordHostSample(fakeDeps(), SPAWNED);

  expect(ledger.record).not.toHaveBeenCalled();
});

it("records nothing outside a repository", async () => {
  vi.mocked(mainRoot).mockResolvedValue(undefined);

  await recordHostSample(withHost(), SPAWNED);

  expect(ledger.record).not.toHaveBeenCalled();
});

it("never throws when the reading fails", async () => {
  sample.mockRejectedValue(new Error("boom"));

  await expect(recordHostSample(withHost(), SPAWNED)).resolves.toBeUndefined();
  expect(ledger.record).not.toHaveBeenCalled();
});

it("never throws when the append fails", async () => {
  ledger.record.mockRejectedValue(new Error("disk full"));

  await expect(recordHostSample(withHost(), SPAWNED)).resolves.toBeUndefined();
});
