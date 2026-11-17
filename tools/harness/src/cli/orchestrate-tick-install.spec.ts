import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  restartJobPath,
  restartJobPlist,
  tickFlagOn,
} from "../orchestrator/index.js";
import type { CliDeps } from "../runtime/index.js";
import { installTickJob } from "./orchestrate-tick-install.js";

vi.mock("node:os", () => ({ homedir: () => "/Users/owner" }));
vi.mock("../orchestrator/index.js", () => ({
  restartJobPath: vi.fn(),
  restartJobPlist: vi.fn(),
  tickFlagOn: vi.fn(),
}));

const ROOT = "/repo";
const PATH = "/Users/owner/Library/LaunchAgents/job.plist";

function setup() {
  const out: string[] = [];
  const err: string[] = [];
  const writeFile = vi.fn().mockResolvedValue(undefined);
  const run = vi.fn();
  const deps = {
    runner: { run },
    fs: { writeFile },
    stdout: (t: string) => out.push(t),
    stderr: (t: string) => err.push(t),
  } as unknown as CliDeps;
  return { deps, out, err, writeFile, run };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(restartJobPath).mockReturnValue(PATH);
  vi.mocked(restartJobPlist).mockReturnValue("<plist/>");
});

describe("orchestrate tick --install with the flag off", () => {
  it("writes no job and fails, so an install the flag does not allow is never silent", async () => {
    vi.mocked(tickFlagOn).mockResolvedValue(false);
    const { deps, err, writeFile } = setup();

    expect(await installTickJob(deps, ROOT)).toBe(1);
    expect(writeFile).not.toHaveBeenCalled();
    expect(err.join("")).toBe(
      "The orchestrator-tick flag is off in the local overlay, so no restart job was written. Turn the flag on after its recorded proof, then rerun orchestrate tick --install.\n",
    );
  });
});

describe("orchestrate tick --install with the flag on", () => {
  beforeEach(() => {
    vi.mocked(tickFlagOn).mockResolvedValue(true);
  });

  it("writes the job for this checkout's harness into the owner's LaunchAgents folder", async () => {
    const { deps, writeFile } = setup();

    expect(await installTickJob(deps, ROOT)).toBe(0);
    expect(restartJobPlist).toHaveBeenCalledWith({
      node: process.execPath,
      harness: "/repo/skills/bin/harness.mjs",
      root: ROOT,
      log: "/Users/owner/Library/Logs/kore-orchestrate-tick.log",
    });
    expect(restartJobPath).toHaveBeenCalledWith("/Users/owner");
    expect(writeFile).toHaveBeenCalledWith(PATH, "<plist/>");
  });

  it("starts nothing: it runs no process, and tells the owner the line that starts the job", async () => {
    const { deps, out, run } = setup();

    await installTickJob(deps, ROOT);

    expect(run).not.toHaveBeenCalled();
    expect(out.join("")).toBe(
      `Wrote ${PATH}. Nothing is running yet. Only the owner starts it, with: launchctl bootstrap "gui/$(id -u)" "${PATH}"\n`,
    );
  });
});
