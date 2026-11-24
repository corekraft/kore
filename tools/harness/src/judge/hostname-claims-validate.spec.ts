import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunResult } from "../runtime/index.js";
import type { ChangedFile } from "./diff.js";
import { JudgeError } from "./errors.js";
import {
  cliBuilt,
  KORE_CLI,
  validateRefusals,
} from "./hostname-claims-validate.js";

// The runner, git and kore's CLI are the collaborators: each answer here is what the
// command would print. The file system holds a scratch directory and the environments.
vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  mkdtemp: vi.fn(),
  readdir: vi.fn(),
  rm: vi.fn(),
}));

const ROOT = "/judge";
const SCRATCH = "/scratch/kore-claims-1";
const ORIGIN = "https://github.com/corekraft/kore.git";
const MAIN = "main-sha";
const HEAD = "head-sha";
const CLI = `${ROOT}/${KORE_CLI}`;
const B = "infra/environments/local/services/b.json";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", code: 0 });
const failed = (stderr: string, code = 1): RunResult => ({
  stdout: "",
  stderr,
  code,
});

interface Answers {
  /** validate's result per environment at main, and at the merge. */
  main?: Record<string, RunResult>;
  merged?: Record<string, RunResult>;
  /** A git subcommand that fails, such as fetch. */
  gitFails?: string;
}

/** A runner that answers git and kore validate from the answers, and records every call. */
function runnerFor(answers: Answers) {
  let merged = false;
  const run = vi.fn(async (command: string, args: readonly string[]) => {
    if (command === "git") {
      if (args[0] === "checkout" && args.includes(HEAD)) {
        merged = true;
      }
      if (args[0] === answers.gitFails) {
        return failed(`${args[0]} went wrong`, 128);
      }
      return args[0] === "remote" ? ok(`${ORIGIN}\n`) : ok();
    }
    const environment = args[args.indexOf("--environment") + 1] ?? "";
    const table = (merged ? answers.merged : answers.main) ?? {};
    return table[environment] ?? ok();
  });
  return run;
}

/** A checkout with a local environment and a common directory that has no overlay. */
beforeEach(() => {
  vi.mocked(mkdtemp).mockResolvedValue(SCRATCH);
  vi.mocked(readdir).mockResolvedValue([
    { name: "local", isDirectory: () => true },
    { name: "common", isDirectory: () => true },
  ] as never);
  vi.mocked(access).mockImplementation(async (path) => {
    if (String(path).includes("common")) {
      throw new Error("ENOENT");
    }
  });
  vi.mocked(rm).mockResolvedValue(undefined);
});

const change = (path: string, deleted = false, previousPath = path) =>
  ({ path, previousPath, deleted }) as ChangedFile;

const validate = (answers: Answers, files: ChangedFile[] = [change(B)]) =>
  validateRefusals({
    runner: { run: runnerFor(answers) },
    root: ROOT,
    mainSha: MAIN,
    headSha: HEAD,
    files,
  });

describe("validateRefusals reports what the merge raises and main does not", () => {
  it("refuses a message only the merge raises, and not one main already raises", async () => {
    const claim = `${B}: spec.hostnames[0] "login.kore.internal" is already claimed by infra/environments/local/services/a.json (service a in suborg platform)`;
    const refusals = await validate({
      main: {
        local: failed(
          "error: infra/environments/local/services/old.json: broken\n",
        ),
      },
      merged: {
        local: failed(
          `error: infra/environments/local/services/old.json: broken\nerror: ${claim}\n`,
        ),
      },
    });
    expect(refusals).toEqual([claim]);
  });

  it("reads kore's warnings as no refusal", async () => {
    const refusals = await validate({
      merged: {
        local: failed(
          "warning: alerts have no contact point\nerror: b.json: a claim\n",
        ),
      },
    });
    expect(refusals).toEqual(["b.json: a claim"]);
  });

  it("refuses nothing when the merge validates in every environment", async () => {
    expect(await validate({})).toEqual([]);
  });

  it("refuses a merge that fails validate with no message, naming the environment", async () => {
    expect(await validate({ merged: { local: failed("") } })).toEqual([
      "kore validate failed for environment local with no message: fix it on main, then rerun the precheck",
    ]);
  });

  it("validates only the environments that have an overlay", async () => {
    const run = runnerFor({});
    await validateRefusals({
      runner: { run },
      root: ROOT,
      mainSha: MAIN,
      headSha: HEAD,
      files: [],
    });
    const validated = run.mock.calls
      .filter(([command]) => command === "node")
      .map(([, args]) => args[args.indexOf("--environment") + 1]);
    expect([...new Set(validated)]).toEqual(["local"]);
  });
});

describe("validateRefusals builds the merge in a scratch checkout", () => {
  it("checks out the PR's changed files at its head and removes those it deleted or renamed away", async () => {
    const run = runnerFor({});
    await validateRefusals({
      runner: { run },
      root: ROOT,
      mainSha: MAIN,
      headSha: HEAD,
      files: [
        change(B),
        change("infra/environments/local/services/c.json", true),
        change(
          "infra/environments/local/services/new.json",
          false,
          "infra/environments/local/services/old.json",
        ),
      ],
    });
    expect(run).toHaveBeenCalledWith(
      "git",
      ["checkout", HEAD, "--", B, "infra/environments/local/services/new.json"],
      { cwd: SCRATCH },
    );
    expect(rm).toHaveBeenCalledWith(
      `${SCRATCH}/infra/environments/local/services/c.json`,
      { force: true },
    );
    expect(rm).toHaveBeenCalledWith(
      `${SCRATCH}/infra/environments/local/services/old.json`,
      { force: true },
    );
  });
});

describe("validateRefusals fetches what it merges by commit", () => {
  it("reads origin from the judge's checkout, and fetches main and the head by commit", async () => {
    const run = runnerFor({});
    await validateRefusals({
      runner: { run },
      root: ROOT,
      mainSha: MAIN,
      headSha: HEAD,
      files: [change(B)],
    });
    expect(run).toHaveBeenCalledWith("git", ["remote", "get-url", "origin"], {
      cwd: ROOT,
    });
    for (const sha of [MAIN, HEAD]) {
      expect(run).toHaveBeenCalledWith(
        "git",
        ["fetch", "--quiet", "--depth", "1", "origin", sha],
        { cwd: SCRATCH },
      );
    }
  });

  it("runs kore validate from the judge's built CLI in the scratch checkout, with main as the record base", async () => {
    const run = runnerFor({});
    await validateRefusals({
      runner: { run },
      root: ROOT,
      mainSha: MAIN,
      headSha: HEAD,
      files: [],
    });
    expect(run).toHaveBeenCalledWith(
      "node",
      [
        CLI,
        "validate",
        "--environment",
        "local",
        "--record-base",
        MAIN,
        "--json",
      ],
      { cwd: SCRATCH },
    );
  });

  it("removes the scratch checkout and throws when git fails", async () => {
    await expect(validate({ gitFails: "fetch" })).rejects.toThrow(JudgeError);
    expect(rm).toHaveBeenCalledWith(SCRATCH, { recursive: true, force: true });
  });
});

describe("cliBuilt", () => {
  it("is true when the judge's checkout has the built kore CLI", async () => {
    vi.mocked(access).mockResolvedValue(undefined);
    await expect(cliBuilt(ROOT)).resolves.toBe(true);
    expect(access).toHaveBeenCalledWith(CLI);
  });

  it("is false when the CLI is not built", async () => {
    vi.mocked(access).mockRejectedValue(new Error("ENOENT"));
    await expect(cliBuilt(ROOT)).resolves.toBe(false);
  });
});
