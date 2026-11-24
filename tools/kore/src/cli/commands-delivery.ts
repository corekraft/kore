import { readFile } from "node:fs/promises";
import { evaluateApp, gitAppSource } from "../delivery/index.js";
import type { CommandContext } from "./context.js";
import { boolFlag, stringFlag, type ParsedArgs } from "./flags.js";
import { print } from "./output.js";

// Docs: docs/decisions/0169-an-app-declares-its-flags-and-the-platform-holds-their-state.md
const SHAPE = 'such as {"1.2.2+def5678": "sha256:<hex>"}';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Runs the deterministic evals on one application repository directory, with no network, and
 * prints the report as JSON. It exits 1 on a failing verdict, which prints no payload to sign.
 * Read-only: it never writes to the repository or the cluster.
 */
export async function evalCommand(context: CommandContext): Promise<number> {
  const { parsed } = context;
  const dir = parsed.positional[0];
  if (dir === undefined) {
    throw new Error(
      "eval needs the app directory: kore eval <dir> --base <ref> --version <semver>+<sha> --digest sha256:<hex>",
    );
  }
  const base = requiredFlag(
    parsed,
    "base",
    "eval needs --base <ref>, the commit the candidate is compared with",
  );
  const version = requiredFlag(
    parsed,
    "version",
    "eval needs --version <semver>+<sha>, such as 1.2.3+abc1234",
  );
  const digest = requiredFlag(
    parsed,
    "digest",
    "eval needs --digest sha256:<hex> of the candidate image",
  );
  const publishedPath = stringFlag(parsed, "published");
  const published =
    publishedPath === undefined
      ? undefined
      : await readPublished(publishedPath);
  const today =
    stringFlag(parsed, "today") ?? new Date().toISOString().slice(0, 10);
  if (!DATE.test(today)) {
    throw new Error(`eval: --today must be a date as YYYY-MM-DD; got ${today}`);
  }
  const report = await evaluateApp(
    gitAppSource({
      runner: context.runner,
      dir,
      base,
      readText: readOptionalText,
    }),
    {
      version,
      digest,
      published,
      today,
      carriesPlan: boolFlag(parsed, "carries-plan"),
      n1: {
        runner: context.runner,
        dir,
        baseEnv: process.env,
        apply: stringFlag(parsed, "n1-apply"),
        previousSuite: stringFlag(parsed, "n1-previous-suite"),
        // The scratch URL is read from the environment only, so it never shows in argv or a log.
        databaseUrl: process.env.KORE_EVAL_SCRATCH_DATABASE_URL,
      },
    },
  );
  print(report, true);
  return report.verdict === "pass" ? 0 : 1;
}

function requiredFlag(
  parsed: ParsedArgs,
  name: string,
  message: string,
): string {
  const value = stringFlag(parsed, name);
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

/** The published versions, each with the digest it was published for. */
async function readPublished(path: string): Promise<Record<string, string>> {
  const shapeError = new Error(
    `eval: --published ${path} must be a JSON object of version to digest, ${SHAPE}`,
  );
  const text = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw shapeError;
    }
    throw error;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw shapeError;
  }
  const published: Record<string, string> = {};
  for (const [version, digest] of Object.entries(parsed)) {
    if (typeof digest !== "string") {
      throw shapeError;
    }
    published[version] = digest;
  }
  return published;
}

/** A file's text, or undefined when it does not exist; any other read error is rethrown. */
async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}
