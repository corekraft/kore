import { beforeEach, describe, expect, it, vi } from "vitest";
import { mainRoot } from "../runtime/index.js";
import {
  asRegistry,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
} from "./deps-support.js";
import type { CliDeps } from "../runtime/index.js";
import type { SessionRegistry } from "./registry.js";
import { reserve } from "./spawn-hc-place.js";
import { place } from "./worktree.js";

const opener = vi.hoisted(() => ({
  open: vi.fn<(deps: CliDeps) => Promise<SessionRegistry>>(),
}));

vi.mock("./registry.js", () => ({ SessionRegistry: opener }));
vi.mock("./worktree.js");
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));

let deps: FakeDeps;
let registry: ReturnType<typeof fakeRegistry>;

beforeEach(() => {
  vi.clearAllMocks();
  deps = fakeDeps();
  registry = fakeRegistry();
  registry.unavailable.mockResolvedValue(undefined);
  opener.open.mockImplementation(async () => asRegistry(registry));
  vi.mocked(mainRoot).mockResolvedValue("/main");
  vi.mocked(place).mockResolvedValue({ cwd: "/repo", left: "" });
});

describe("reserve refuses a name whose record is still open, and places nothing", () => {
  it("refuses with the registry's reason, rewritten for an hc session, and never places a directory", async () => {
    registry.unavailable.mockResolvedValue(
      "A session record for image-trust-reader (pane t7) already exists and is not closed. No pane was split.",
    );

    await expect(reserve(deps, {}, "image-trust-reader")).resolves.toEqual({
      error:
        "A session record for image-trust-reader (pane t7) already exists and is not closed. No terminal was started.",
    });
    expect(place).not.toHaveBeenCalled();
  });
});

describe("reserve places the session and names the main checkout", () => {
  it("places the caller's directory when there is no worktree, and reserves the registry", async () => {
    await expect(reserve(deps, {}, "image-trust-reader")).resolves.toEqual({
      registry: asRegistry(registry),
      cwd: "/repo",
      main: "/main",
    });
    expect(place).toHaveBeenCalledExactlyOnceWith(
      deps,
      {},
      "image-trust-reader",
    );
  });

  it("returns the worktree it placed, so the record can name it", async () => {
    const worktree = { path: "/repo/.claude/worktrees/x", branch: "feat/x" };
    vi.mocked(place).mockResolvedValue({
      cwd: worktree.path,
      left: "",
      worktree,
    });

    await expect(reserve(deps, { worktree: true }, "x")).resolves.toEqual({
      registry: asRegistry(registry),
      cwd: worktree.path,
      main: "/main",
      worktree,
    });
  });

  it("refuses when the placement fails, with the placement's own reason", async () => {
    vi.mocked(place).mockResolvedValue({ error: "git worktree add failed" });

    await expect(reserve(deps, {}, "x")).resolves.toEqual({
      error: "git worktree add failed",
    });
  });

  it("refuses when there is no main checkout to keep state in, and says how to name one", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);

    await expect(reserve(deps, {}, "x")).resolves.toEqual({
      error:
        "Cannot find the main checkout to keep session state in. Run inside the repository or set KORE_ROOT to its root.",
    });
  });
});
