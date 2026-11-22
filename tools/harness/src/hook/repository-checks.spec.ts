import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { hookCommand, type HookContext } from "./io.js";
import { kbCheck } from "./kb-check.js";
import { linkProblems } from "./skill-links.js";
import { workflowProblems } from "./workflow-permissions.js";
import "./repository-checks.js";

vi.mock("./io.js");
vi.mock("./kb-check.js");
vi.mock("./skill-links.js");
vi.mock("./workflow-permissions.js");

/** The one assertion: a fake whose members the unit reads only through its mocked checks. */
const asCliDeps = (parts: object) => parts as CliDeps;
const FS = { tag: "fs" };
const ROOT = "/repo";

/** The hooks this module built, each read from the hookCommand call that ran when it loaded, by name. */
const built = vi.mocked(hookCommand).mock.calls;
function builtAs(name: string) {
  const call = built.find((args) => args[0] === name);
  if (call === undefined) {
    throw new Error(`repository-checks did not build the ${name} hook`);
  }
  return call;
}
const skillLinksCall = builtAs("skill-links");
const workflowCall = builtAs("workflow-permissions");
const kbCall = builtAs("kb-check");

/** Runs a built handler as the host does, with the given deps and options. */
function runHandler(
  call: ReturnType<typeof builtAs>,
  deps: CliDeps,
  options: Record<string, string | boolean> = {},
) {
  const context: HookContext = {
    deps,
    payload: undefined,
    options,
    operand: undefined,
  };
  return call[2](context);
}

beforeEach(() => {
  vi.mocked(linkProblems).mockResolvedValue([]);
  vi.mocked(workflowProblems).mockResolvedValue([]);
  vi.mocked(kbCheck).mockResolvedValue({ code: 0 });
});

describe("skill-links hook: the links it checks", () => {
  it("passes the file system and the repository root to the link check", async () => {
    const deps = asCliDeps({ fs: FS, root: () => Promise.resolve(ROOT) });

    await runHandler(skillLinksCall, deps);

    expect(linkProblems).toHaveBeenCalledWith(FS, ROOT);
  });

  it("exits 0 and prints nothing when every skill is linked", async () => {
    const deps = asCliDeps({ fs: FS, root: () => Promise.resolve(ROOT) });

    expect(await runHandler(skillLinksCall, deps)).toEqual({});
  });

  it("exits 1 and names each problem on stderr, one per line", async () => {
    vi.mocked(linkProblems).mockResolvedValue(["a.md broken", "b.md absolute"]);
    const deps = asCliDeps({ fs: FS, root: () => Promise.resolve(ROOT) });

    expect(await runHandler(skillLinksCall, deps)).toEqual({
      code: 1,
      stderr: "a.md broken\nb.md absolute\n",
    });
  });
});

describe("workflow-permissions hook: the workflows it checks", () => {
  it("exits 0 when every workflow's token permissions pass the signer guard", async () => {
    const deps = asCliDeps({ fs: FS, root: () => Promise.resolve(ROOT) });

    expect(await runHandler(workflowCall, deps)).toEqual({});
    expect(workflowProblems).toHaveBeenCalledWith(FS, ROOT);
  });

  it("exits 1 and names each workflow that breaks the signer guard", async () => {
    vi.mocked(workflowProblems).mockResolvedValue(["ci.yml writes contents"]);
    const deps = asCliDeps({ fs: FS, root: () => Promise.resolve(ROOT) });

    expect(await runHandler(workflowCall, deps)).toEqual({
      code: 1,
      stderr: "ci.yml writes contents\n",
    });
  });
});

describe("kb-check hook: the knowledge-base check it runs", () => {
  it("reads no host payload and fails closed with exit 1 when the hook breaks", () => {
    expect(kbCall[3]).toEqual({
      payload: false,
      faultCode: 1,
      help: expect.objectContaining({ purpose: expect.any(String) }),
    });
  });

  it("passes strict through when --strict is given, and false otherwise", async () => {
    const deps = asCliDeps({ tag: "deps" });

    await runHandler(kbCall, deps, { strict: true });
    await runHandler(kbCall, deps, {});

    expect(kbCheck).toHaveBeenNthCalledWith(1, true, deps);
    expect(kbCheck).toHaveBeenNthCalledWith(2, false, deps);
  });

  it("returns the knowledge-base check's own result unchanged", async () => {
    vi.mocked(kbCheck).mockResolvedValue({ code: 1, stderr: "README gap\n" });
    const deps = asCliDeps({ tag: "deps" });

    expect(await runHandler(kbCall, deps)).toEqual({
      code: 1,
      stderr: "README gap\n",
    });
  });
});
