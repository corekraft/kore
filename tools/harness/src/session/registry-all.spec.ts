import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mainRoot } from "../runtime/index.js";
import { fakeDeps, type FakeDeps } from "./deps-support.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";

vi.mock("node:path");
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));

const STATE = "/main/.kore/state/sessions";
const RECORD: SessionRecord = {
  name: "image-trust-writer",
  paneId: "w3:p9",
  callerPane: "w3:p1",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};

/** Opens the registry the way a command does, over the fake deps. */
async function openWith(deps: FakeDeps): Promise<SessionRegistry> {
  return SessionRegistry.open(deps);
}

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(resolve).mockImplementation((...parts: string[]) =>
    parts.join("/"),
  );
  vi.mocked(mainRoot).mockResolvedValue("/main");
});

describe("SessionRegistry.all", () => {
  it("lists the readable records and each unreadable file with its terminal, and none before the directory exists", async () => {
    const deps = fakeDeps();
    vi.mocked(deps.fs.exists).mockResolvedValueOnce(false);
    expect(await (await openWith(deps)).all()).toEqual({
      records: [],
      unreadable: [],
    });
    vi.mocked(deps.fs.exists).mockResolvedValue(true);
    vi.mocked(deps.fs.readdir).mockResolvedValue(["a.json", "b.json", "c.txt"]);
    vi.mocked(deps.fs.readFile).mockImplementation(async (path) =>
      path.endsWith("a.json") ? '{"terminal": "t9", ' : JSON.stringify(RECORD),
    );
    expect(await (await openWith(deps)).all()).toEqual({
      records: [RECORD],
      unreadable: [
        {
          file: `${STATE}/a.json`,
          reason: expect.stringContaining("is not a valid session record"),
          terminal: "t9",
        },
      ],
    });
  });
});
