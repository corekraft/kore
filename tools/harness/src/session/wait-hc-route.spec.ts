import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { FakeTerminals } from "../terminal/index.js";
import { routeSession } from "./backend.js";
import {
  asRegistry,
  contextOf,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
  type FakeRegistry,
} from "./deps-support.js";
import { FAILED, fail } from "./output.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";
import { DEFAULT_TIMEOUT_MS, wait } from "./wait.js";
import { formatReportWait, waitForReport } from "./wait-hc.js";

const opener = vi.hoisted(() => ({
  open: vi.fn<(deps: CliDeps) => Promise<SessionRegistry>>(),
}));

vi.mock("./registry.js", () => ({ SessionRegistry: opener }));
vi.mock("./output.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./output.js")>()),
  fail: vi.fn(),
}));
vi.mock("./backend.js");
vi.mock("./equalize.js");
vi.mock("./finish-record.js");
vi.mock("./names.js");
vi.mock("./wait-hc.js");

const HC_RECORD: SessionRecord = {
  version: 1,
  backend: "hc",
  terminal: "t2",
  name: "image-trust-writer",
  paneId: "t2",
  model: "claude-opus-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};

let deps: FakeDeps;
let registry: FakeRegistry;

beforeEach(() => {
  deps = fakeDeps();
  registry = fakeRegistry();
  opener.open.mockResolvedValue(asRegistry(registry));
  vi.mocked(fail).mockImplementation((_deps, _json, code) => code);
});

describe("wait on an hc session waits through hc and reads its report, never a herdr pane", () => {
  it("waits on the hc terminal and prints the report's outcome, without reading a herdr pane", async () => {
    const hc = new FakeTerminals();
    const result = {
      name: "image-trust-writer",
      model: "claude-opus-5-5",
      outcome: "done" as const,
      summary: "Opened PR #5.",
      seq: 1,
    };
    vi.mocked(routeSession).mockReturnValue({ backend: "hc", terminals: hc });
    vi.mocked(waitForReport).mockResolvedValue(result);
    vi.mocked(formatReportWait).mockReturnValue("<report wait line>\n");
    registry.read.mockResolvedValue(HC_RECORD);

    const code = await wait(contextOf(deps, { operand: "image-trust-writer" }));

    expect(code).toBe(0);
    expect(waitForReport).toHaveBeenCalledWith(
      deps,
      hc,
      asRegistry(registry),
      HC_RECORD,
      DEFAULT_TIMEOUT_MS,
    );
    expect(deps.runner.run).not.toHaveBeenCalled();
    expect(formatReportWait).toHaveBeenCalledWith(result);
    expect(deps.stdout).toHaveBeenCalledWith("<report wait line>\n");
  });

  it("fails with hc's message when the report wait cannot answer", async () => {
    vi.mocked(routeSession).mockReturnValue({
      backend: "hc",
      terminals: new FakeTerminals(),
    });
    vi.mocked(waitForReport).mockResolvedValue({
      error: "Session image-trust-writer: no terminal t2",
    });
    registry.read.mockResolvedValue(HC_RECORD);

    const code = await wait(contextOf(deps, { operand: "image-trust-writer" }));

    expect(code).toBe(FAILED);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      FAILED,
      "Session image-trust-writer: no terminal t2",
    );
  });
});
