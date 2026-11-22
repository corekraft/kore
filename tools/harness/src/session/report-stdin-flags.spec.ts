import { beforeEach, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { FakeTerminals } from "../terminal/index.js";
import { routeSession, terminalsFor } from "./backend.js";
import {
  asRegistry,
  contextOf,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
  type FakeRegistry,
} from "./deps-support.js";
import { USAGE_ERROR, fail } from "./output.js";
import { report } from "./report.js";
import {
  isInsideReportDir,
  noticeLine,
  readReport,
  reportDirOf,
  reportPath,
} from "./report-file.js";
import { bothStdinError } from "./report-input.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";

const opener = vi.hoisted(() => ({
  open: vi.fn<(deps: CliDeps) => Promise<SessionRegistry>>(),
}));

vi.mock("./registry.js", () => ({ SessionRegistry: opener }));
vi.mock("./backend.js");
vi.mock("./report-file.js");
vi.mock("./output.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./output.js")>()),
  fail: vi.fn(),
}));

const RECORD: SessionRecord = {
  version: 1,
  backend: "hc",
  terminal: "t2",
  name: "image-trust-writer",
  paneId: "t2",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};
const REPORT_DIR = "/work/writer/.kore/report";
const REPORT = "/work/writer/.kore/report/image-trust-writer.json";
const NOTICE = `image-trust-writer done seq 1: ${REPORT}`;
const USAGE =
  "session report --outcome done|blocked (--summary <text> | --summary - | --file <path>) [--plan <file> | --plan -]";

let deps: FakeDeps;
let registry: FakeRegistry;

/** Routes the record to hc over a parent t1 in the main checkout and the writer t2 in its worktree. */
async function setUpTerminals(): Promise<void> {
  const terminals = new FakeTerminals({ self: "t2" });
  await terminals.run({ argv: ["claude"], cwd: "/main" });
  await terminals.run({
    argv: ["claude"],
    cwd: "/work/writer",
    name: "image-trust-writer",
    parent: "t1",
  });
  vi.mocked(terminalsFor).mockReturnValue(terminals);
  vi.mocked(routeSession).mockReturnValue({ backend: "hc", terminals });
}

beforeEach(async () => {
  deps = fakeDeps();
  deps.cwd = "/work/writer";
  registry = fakeRegistry();
  opener.open.mockResolvedValue(asRegistry(registry));
  registry.findByTerminal.mockResolvedValue(RECORD);
  vi.mocked(reportPath).mockReturnValue(REPORT);
  vi.mocked(reportDirOf).mockReturnValue(REPORT_DIR);
  vi.mocked(isInsideReportDir).mockResolvedValue(true);
  vi.mocked(readReport).mockResolvedValue(undefined);
  vi.mocked(noticeLine).mockReturnValue(NOTICE);
  vi.mocked(fail).mockImplementation((_deps, _json, code) => code);
  await setUpTerminals();
});

it("stores exactly the text on stdin as the summary when --summary is -", async () => {
  deps.stdin.mockResolvedValue("VERDICT: none\nEND VERDICT\n");

  await report(contextOf(deps, { options: { outcome: "done", summary: "-" } }));

  expect(
    JSON.parse(String(deps.fs.writeFile.mock.calls[0]?.[1])),
  ).toMatchObject({
    summary: "VERDICT: none\nEND VERDICT\n",
  });
});

it("refuses both flags reading stdin, since stdin is read once", async () => {
  await report(
    contextOf(deps, { options: { outcome: "done", summary: "-", plan: "-" } }),
  );

  expect(fail).toHaveBeenCalledWith(
    deps,
    expect.anything(),
    USAGE_ERROR,
    bothStdinError(USAGE),
  );
  expect(deps.stdin).not.toHaveBeenCalled();
});
