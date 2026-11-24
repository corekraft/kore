import { beforeEach, expect, test, vi } from "vitest";
import { CommandError, type Runner } from "../runtime/index.js";
import { immutabilityReport } from "./app-record-base.js";
import { organizationChangeErrors } from "./app-record-rules.js";

vi.mock("./app-record-rules.js");

const file = "infra/environments/local/services/leads.json";
const record = { stem: "leads", file, organization: "platform" };
/** The command the base reader runs; a name, so an assertion's first argument is not a literal. */
const gitCommand = "git";

/** A git subcommand that fails with git's own stderr instead of answering. */
interface GitBreak {
  subcommand: "ls-tree" | "show";
  stderr: string;
}

/**
 * A runner whose git answers from `refs` (which refs resolve) and `blobs` (a file at a
 * ref). `ls-tree` prints the file's name when the ref has it and nothing when it does
 * not, as git does; `show` reads a blob. `broken` makes one subcommand fail as git does.
 */
function gitRunner(
  refs: string[],
  blobs: Record<string, string> = {},
  broken?: GitBreak,
) {
  const run = vi.fn(async (command: string, args: readonly string[]) => {
    if (command !== gitCommand) {
      throw new Error(`unexpected command ${command}`);
    }
    const [subcommand] = args;
    if (broken !== undefined && subcommand === broken.subcommand) {
      throw new CommandError(gitCommand, args, {
        stdout: "",
        stderr: broken.stderr,
        code: 128,
      });
    }
    if (subcommand === "rev-parse") {
      const ref = args[args.indexOf("--quiet") + 1]!.replace(
        /\^\{commit\}$/,
        "",
      );
      if (refs.includes(ref)) {
        return { stdout: "", stderr: "", code: 0 };
      }
      throw new Error(`git rev-parse ${ref} failed`);
    }
    if (subcommand === "ls-tree") {
      // ls-tree --full-tree --name-only <ref> -- <file>
      const ref = args[3]!;
      const path = args.at(-1)!;
      const present = blobs[`${ref}:${path}`] !== undefined;
      return { stdout: present ? `${path}\n` : "", stderr: "", code: 0 };
    }
    const blob = blobs[args[1]!];
    if (blob === undefined) {
      throw new Error("fatal: path does not exist");
    }
    return { stdout: blob, stderr: "", code: 0 };
  });
  return { run } as unknown as Runner & { run: typeof run };
}

beforeEach(() => {
  vi.mocked(organizationChangeErrors).mockReturnValue([]);
});

test("a service whose organization changes against origin/main is passed to the immutability rule with both values", async () => {
  const runner = gitRunner(["origin/main"], {
    [`origin/main:${file}`]: JSON.stringify({
      spec: { organization: "sales" },
    }),
  });
  await immutabilityReport({ root: "/repo", runner, records: [record] });
  expect(runner.run).toHaveBeenCalledWith(
    gitCommand,
    ["show", `origin/main:${file}`],
    { capture: true, cwd: "/repo" },
  );
  expect(organizationChangeErrors).toHaveBeenCalledWith({
    file,
    name: "leads",
    base: "sales",
    current: "platform",
    ref: "origin/main",
  });
});

test("a service absent at the base ref has no base organization, so it is new", async () => {
  const runner = gitRunner(["origin/main"]);
  await immutabilityReport({ root: "/repo", runner, records: [record] });
  expect(organizationChangeErrors).toHaveBeenCalledWith(
    expect.objectContaining({ base: undefined }),
  );
});

test("a service absent at the base ref reads nothing from the base, so it passes as new", async () => {
  const runner = gitRunner(["origin/main"]);
  await immutabilityReport({ root: "/repo", runner, records: [record] });
  expect(runner.run).not.toHaveBeenCalledWith(
    gitCommand,
    ["show", `origin/main:${file}`],
    expect.anything(),
  );
});

test("a git failure other than absence while looking up the base file fails the check with the fix, and no organization is compared", async () => {
  const runner = gitRunner(
    ["origin/main"],
    {},
    {
      subcommand: "ls-tree",
      stderr: "fatal: unable to read tree (5f1c0e2)",
    },
  );
  const outcome = immutabilityReport({
    root: "/repo",
    runner,
    records: [record],
  });
  await expect(outcome).rejects.toThrow(
    `could not read ${file} at origin/main`,
  );
  await expect(outcome).rejects.toThrow("fatal: unable to read tree");
  await expect(outcome).rejects.toThrow("git fsck");
  await expect(outcome).rejects.toThrow("--record-base <ref>");
  expect(organizationChangeErrors).not.toHaveBeenCalled();
});

test("a git failure reading a base file that exists is rethrown, so a broken base cannot pass as a new service", async () => {
  const runner = gitRunner(
    ["origin/main"],
    {
      [`origin/main:${file}`]: JSON.stringify({
        spec: { organization: "sales" },
      }),
    },
    { subcommand: "show", stderr: "fatal: unable to read blob" },
  );
  const outcome = immutabilityReport({
    root: "/repo",
    runner,
    records: [record],
  });
  await expect(outcome).rejects.toThrow(
    `could not read ${file} at origin/main`,
  );
  await expect(outcome).rejects.toThrow("fatal: unable to read blob");
  expect(organizationChangeErrors).not.toHaveBeenCalled();
});

test("a base copy that is not strict JSON has no organization to compare", async () => {
  const runner = gitRunner(["origin/main"], {
    [`origin/main:${file}`]: "{ organization: sales",
  });
  await immutabilityReport({ root: "/repo", runner, records: [record] });
  expect(organizationChangeErrors).toHaveBeenCalledWith(
    expect.objectContaining({ base: undefined }),
  );
});

test("the base copy's own spec without an organization is compared as absent", async () => {
  const runner = gitRunner(["origin/main"], {
    [`origin/main:${file}`]: JSON.stringify({ spec: null }),
  });
  await immutabilityReport({ root: "/repo", runner, records: [record] });
  expect(organizationChangeErrors).toHaveBeenCalledWith(
    expect.objectContaining({ base: undefined }),
  );
});

test("an explicit --record-base is compared against, and its errors are returned", async () => {
  const runner = gitRunner(["release/1"], {
    [`release/1:${file}`]: JSON.stringify({ spec: { organization: "sales" } }),
  });
  vi.mocked(organizationChangeErrors).mockReturnValue(["changed"]);
  expect(
    await immutabilityReport({
      root: "/repo",
      runner,
      recordBase: "release/1",
      records: [record],
    }),
  ).toEqual({ errors: ["changed"], warnings: [] });
  expect(runner.run).toHaveBeenCalledWith(
    gitCommand,
    ["show", `release/1:${file}`],
    expect.anything(),
  );
});

test("an explicit --record-base that does not resolve is an error naming the flag", async () => {
  const runner = gitRunner(["origin/main"]);
  expect(
    await immutabilityReport({
      root: "/repo",
      runner,
      recordBase: "no-such-ref",
      records: [record],
    }),
  ).toEqual({
    errors: [
      "--record-base no-such-ref does not resolve to a commit; name a commit that exists in this repository, or drop the flag to compare against origin/main",
    ],
    warnings: [],
  });
});

test("a default base that does not resolve is a warning, and no record is compared", async () => {
  const runner = gitRunner([]);
  expect(
    await immutabilityReport({ root: "/repo", runner, records: [record] }),
  ).toEqual({
    errors: [],
    warnings: [
      "the organization immutability check was not run: origin/main does not resolve (no git or no origin); pass --record-base <ref> to compare against another ref",
    ],
  });
  expect(organizationChangeErrors).not.toHaveBeenCalled();
});

test("with no records to compare, the base is resolved and nothing is read from it", async () => {
  const runner = gitRunner(["origin/main"]);
  expect(
    await immutabilityReport({ root: "/repo", runner, records: [] }),
  ).toEqual({ errors: [], warnings: [] });
  expect(runner.run).toHaveBeenCalledTimes(1);
});
