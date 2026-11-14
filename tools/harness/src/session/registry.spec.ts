import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandError, mainRoot } from "../runtime/index.js";
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
const FILE = `${STATE}/image-trust-writer.json`;
const CLOSED = { ...RECORD, closedAt: "2026-01-02T03:06:00.000Z" };
const OPEN_REASON =
  "A session record for image-trust-writer (pane w3:p9) already exists and is not closed; run `session wait image-trust-writer` then `session close image-trust-writer`, or pick another name. No pane was split.";

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

describe("SessionRegistry.open", () => {
  it("keeps state under the main checkout's .kore/state/sessions", async () => {
    const deps = fakeDeps();

    const registry = await openWith(deps);
    await registry.write(RECORD);

    expect(mainRoot).toHaveBeenCalledWith(deps);
    expect(resolve).toHaveBeenCalledWith("/main", ".kore/state/sessions");
    expect(deps.fs.writeFile).toHaveBeenCalledWith(FILE, expect.any(String));
  });

  it("refuses, naming the fix, when the main checkout cannot be found", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);

    await expect(openWith(fakeDeps())).rejects.toThrow(
      new CommandError(
        "Cannot find the main checkout to keep session state in. Run inside the repository or set KORE_ROOT to its root.",
      ),
    );
  });
});

describe("SessionRegistry.read", () => {
  it("returns undefined, without reading, when no file exists for the name", async () => {
    const deps = fakeDeps();
    deps.fs.exists.mockResolvedValue(false);

    const registry = await openWith(deps);

    await expect(registry.read("image-trust-writer")).resolves.toBeUndefined();
    expect(deps.fs.readFile).not.toHaveBeenCalled();
  });

  it("returns the record the file holds", async () => {
    const deps = fakeDeps();
    deps.fs.exists.mockResolvedValue(true);
    deps.fs.readFile.mockResolvedValue(JSON.stringify(RECORD));

    const registry = await openWith(deps);

    await expect(registry.read("image-trust-writer")).resolves.toEqual(RECORD);
    expect(deps.fs.readFile).toHaveBeenCalledWith(FILE);
  });

  it("names the file and the fix when the file is not JSON", async () => {
    const deps = fakeDeps();
    deps.fs.exists.mockResolvedValue(true);
    deps.fs.readFile.mockResolvedValue("{not json");

    const registry = await openWith(deps);

    await expect(registry.read("image-trust-writer")).rejects.toThrow(
      new CommandError(
        `Session state ${FILE} is not a valid session record; delete it and spawn the session again.`,
      ),
    );
  });

  it("names the file and the fix when the JSON lacks the record's fields", async () => {
    const deps = fakeDeps();
    deps.fs.exists.mockResolvedValue(true);
    deps.fs.readFile.mockResolvedValue(JSON.stringify({ name: "x" }));

    const registry = await openWith(deps);

    await expect(registry.read("image-trust-writer")).rejects.toThrow(
      CommandError,
    );
  });

  it("rethrows a read failure that is not a parse error", async () => {
    const deps = fakeDeps();
    deps.fs.exists.mockResolvedValue(true);
    deps.fs.readFile.mockRejectedValue(new Error("EACCES: permission denied"));

    const registry = await openWith(deps);

    await expect(registry.read("image-trust-writer")).rejects.toThrow(
      "EACCES: permission denied",
    );
  });
});

describe("SessionRegistry.write", () => {
  it("writes the record as two-space JSON with a trailing newline", async () => {
    const deps = fakeDeps();

    const registry = await openWith(deps);
    await registry.write(RECORD);

    expect(deps.fs.writeFile).toHaveBeenCalledExactlyOnceWith(
      FILE,
      `${JSON.stringify(RECORD, null, 2)}\n`,
    );
  });
});

describe("SessionRegistry.unavailable", () => {
  it("is undefined when no record exists for the name", async () => {
    const deps = fakeDeps();
    deps.fs.exists.mockResolvedValue(false);

    const registry = await openWith(deps);

    await expect(registry.unavailable("image-trust-writer")).resolves.toBe(
      undefined,
    );
  });

  it("is undefined when the record is closed, so the name is free again", async () => {
    const deps = fakeDeps();
    deps.fs.exists.mockResolvedValue(true);
    deps.fs.readFile.mockResolvedValue(JSON.stringify(CLOSED));

    const registry = await openWith(deps);

    await expect(registry.unavailable("image-trust-writer")).resolves.toBe(
      undefined,
    );
  });

  it("names the pane and the two commands that free an open record's name", async () => {
    const deps = fakeDeps();
    deps.fs.exists.mockResolvedValue(true);
    deps.fs.readFile.mockResolvedValue(JSON.stringify(RECORD));

    const registry = await openWith(deps);

    await expect(registry.unavailable("image-trust-writer")).resolves.toBe(
      OPEN_REASON,
    );
  });
});

describe("SessionRegistry.create", () => {
  it("creates the file exclusively, with the record as two-space JSON", async () => {
    const deps = fakeDeps();

    const registry = await openWith(deps);
    await registry.create(RECORD);

    expect(deps.fs.createFile).toHaveBeenCalledExactlyOnceWith(
      FILE,
      `${JSON.stringify(RECORD, null, 2)}\n`,
    );
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });

  it("refuses an open record under the same name, saying the pane runs unrecorded", async () => {
    const deps = fakeDeps();
    deps.fs.createFile.mockRejectedValue(
      Object.assign(new Error("exists"), { code: "EEXIST" }),
    );
    deps.fs.exists.mockResolvedValue(true);
    deps.fs.readFile.mockResolvedValue(JSON.stringify(RECORD));

    const registry = await openWith(deps);

    await expect(registry.create(RECORD)).rejects.toThrow(
      new CommandError(
        OPEN_REASON.replace(
          " No pane was split.",
          " Pane w3:p9 is running unrecorded; close it with `herdr pane close w3:p9`.",
        ),
      ),
    );
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });

  it("replaces a closed record under the same name", async () => {
    const deps = fakeDeps();
    deps.fs.createFile.mockRejectedValue(
      Object.assign(new Error("exists"), { code: "EEXIST" }),
    );
    deps.fs.exists.mockResolvedValue(true);
    deps.fs.readFile.mockResolvedValue(JSON.stringify(CLOSED));

    const registry = await openWith(deps);
    await registry.create(RECORD);

    expect(deps.fs.writeFile).toHaveBeenCalledExactlyOnceWith(
      FILE,
      `${JSON.stringify(RECORD, null, 2)}\n`,
    );
  });

  it("rethrows a create failure that is not EEXIST, leaving the record unwritten", async () => {
    const deps = fakeDeps();
    deps.fs.createFile.mockRejectedValue(
      Object.assign(new Error("no space left"), { code: "ENOSPC" }),
    );

    const registry = await openWith(deps);

    await expect(registry.create(RECORD)).rejects.toThrow("no space left");
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });
});
