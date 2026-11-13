// Records which trees already passed the commit hook's tests, so a commit of a
// tree that passed runs none again. A record is one file per tree hash under
// the main checkout's .kore/state/test-pass, shared by every worktree: a tree
// hash names exact content, so a pass for it holds wherever it is committed.
// CI `check` still runs the full suites; nothing here replaces it.
// Docs: docs/guides/contributor.md (Commit hooks)

import { join } from "node:path";
import {
  CommandError,
  mainRoot,
  type Command,
  type CommandContext,
} from "../runtime/index.js";

const TREE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const RECORDS = join(".kore", "state", "test-pass");

/** The tree to act on: --tree, else the tree of the current index. */
async function treeOf({ options, deps }: CommandContext): Promise<string> {
  const given = options["tree"];
  if (typeof given === "string") {
    if (!TREE.test(given)) {
      throw new CommandError(
        "--tree must be a full git tree hash; omit it to use the staged tree.",
      );
    }
    return given;
  }
  const git = await deps.runner.run("git", ["write-tree"], { cwd: deps.cwd });
  const tree = git.stdout.trim();
  if (git.code !== 0 || !TREE.test(tree)) {
    throw new CommandError(
      `Could not read the staged tree: ${git.stderr.trim() || "git write-tree failed"}. Resolve merge conflicts, then retry.`,
    );
  }
  return tree;
}

async function recordPath(context: CommandContext, tree: string) {
  const main = await mainRoot(context.deps);
  if (main === undefined) {
    throw new CommandError(
      "Could not find the main checkout; run from the repository or set KORE_ROOT.",
    );
  }
  return join(main, RECORDS, tree);
}

const record: Command = {
  summary: "record that the tests passed at the staged tree",
  options: { tree: "string" },
  async run(context) {
    const tree = await treeOf(context);
    const { deps, json } = context;
    const at = deps.clock.now().toISOString();
    await deps.fs.writeFile(
      await recordPath(context, tree),
      `${JSON.stringify({ tree, at })}\n`,
    );
    deps.stdout(
      json
        ? `${JSON.stringify({ tree, recorded: true })}\n`
        : `recorded: tests passed at tree ${tree}\n`,
    );
    return 0;
  },
};

const check: Command = {
  summary: "exit 0 when the tests already passed at the staged tree",
  options: { tree: "string" },
  async run(context) {
    const tree = await treeOf(context);
    const { deps, json } = context;
    const passed = await deps.fs.exists(await recordPath(context, tree));
    const words = passed
      ? `tests already passed at tree ${tree}`
      : `no recorded pass at tree ${tree}`;
    deps.stdout(json ? `${JSON.stringify({ tree, passed })}\n` : `${words}\n`);
    return passed ? 0 : 1;
  },
};

export const testPassCommands: Record<string, Command> = { check, record };
