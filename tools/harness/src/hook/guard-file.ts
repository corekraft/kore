// File rules for Read, Write and Edit. Blocks: secret-path, sops-plaintext,
// coverage-threshold. Audit mode (warn): append-only, idea-outcome,
// flag-activation, image-digest, guardrail-demotion.
import { INVENTORY_PATH } from "../guardrail/index.js";
import { checkGuardrailDemotion } from "./guard-guardrails.js";
import { appendOnlyWarn, isAppendOnly } from "./guard-append-only.js";
import {
  SECRET_PATH,
  loadSopsPatterns,
  secretBlock,
  sopsBlock,
} from "./guard-secrets.js";
import {
  allow,
  applyMode,
  block,
  warn,
  type Finding,
  type GuardContext,
  type Hit,
  type Verdict,
} from "./guard-verdict.js";

type Input = Record<string, unknown>;

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** What an edit writes: the new snippet of an Edit, or the whole content of a Write. */
const written = (tool: string, input: Input): string =>
  text(tool === "Edit" ? input["new_string"] : input["content"]);

/** The file's text before the change: the old snippet of an Edit, or what is on disk; empty when absent. */
async function before(
  tool: string,
  input: Input,
  relative: string,
  ctx: GuardContext,
  rethrow: boolean,
): Promise<string> {
  if (tool === "Edit") {
    return text(input["old_string"]);
  }
  try {
    return await ctx.readFile(`${ctx.root}/${relative}`);
  } catch (error) {
    if (rethrow && (error as { code?: unknown } | null)?.code !== "ENOENT") {
      throw error;
    }
    return "";
  }
}

const THRESHOLD =
  /\b(statements|branches|functions|lines)\s*:\s*(\d+(?:\.\d+)?)/g;

function thresholds(source: string): Map<string, number> {
  return new Map(
    [...source.matchAll(THRESHOLD)].map((match) => [
      match[1] as string,
      Number(match[2]),
    ]),
  );
}

function lowersThresholds(previous: string, after: string): boolean {
  const old = thresholds(previous);
  for (const [key, value] of thresholds(after)) {
    const was = old.get(key);
    if (was !== undefined && value < was) {
      return true;
    }
  }
  return false;
}

const IMAGE_LINE = /^\s*-?\s*image:\s*["']?([^\s"'#]+)/gm;

// Feature flags: turned on only by `harness flag activate`, which requires a recorded live
// proof (ADR 0077). Warns on any hand edit that sets a flag in an overlay's features map
// to true. Audit mode (warn) first, per ADR 0080; `harness flag audit` is the CI backstop.
const OVERLAY_PATH = /^infra\/environments\/[^/]+\/environment\.yaml$/;
const FEATURES_BLOCK = /["']?features["']?\s*:\s*\{[^}]*\}/s;
const FLAG_ON = /["']?([a-z][a-z0-9-]*)["']?\s*:\s*true\b/g;
const FLAG_OFF = /["']?([a-z][a-z0-9-]*)["']?\s*:\s*false\b/g;

const flagsIn = (source: string, pattern: RegExp): Set<string> =>
  new Set([...source.matchAll(pattern)].map((m) => m[1] as string));

function flagsOn(source: string, previous: string): Set<string> {
  const features = FEATURES_BLOCK.exec(source)?.[0];
  if (features !== undefined) {
    return flagsIn(features, FLAG_ON);
  }
  // An edit's snippet may lack the features key; only a flip from false counts.
  const off = flagsIn(previous, FLAG_OFF);
  return new Set([...flagsIn(source, FLAG_ON)].filter((name) => off.has(name)));
}

async function checkFlagOn(
  tool: string,
  input: Input,
  relative: string,
  ctx: GuardContext,
): Promise<Finding> {
  if (!OVERLAY_PATH.test(relative)) {
    return null;
  }
  const previous = await before(tool, input, relative, ctx, true);
  const after = written(tool, input);
  const already = flagsIn(FEATURES_BLOCK.exec(previous)?.[0] ?? "", FLAG_ON);
  const added = [...flagsOn(after, previous)].filter(
    (name) => !already.has(name),
  );
  if (tool === "Write" && !FEATURES_BLOCK.test(after)) {
    return null;
  }
  if (added.length === 0) {
    return null;
  }
  return warn(
    "flag-activation",
    `${relative} turns on flag ${added[0]} by hand. A flag turns on only with a recorded live proof. ` +
      "Instead, record a confirmed live-run verification outcome (`harness outcome record --kind verification --source live-run --flag <name> --environment <env> ...`), then run `harness flag activate <flag> --environment <env>`.",
  );
}

function checkImageDigest(
  tool: string,
  input: Input,
  relative: string,
): Finding {
  if (
    !relative.startsWith("apps/") &&
    !relative.startsWith("infra/environments/")
  ) {
    return null;
  }
  const tagged = [...written(tool, input).matchAll(IMAGE_LINE)].filter(
    (m) => !(m[1] as string).includes("@sha256:"),
  );
  if (tagged.length === 0) {
    return null;
  }
  return warn(
    "image-digest",
    `${(tagged[0] as RegExpMatchArray)[1]} is not pinned by digest. Images are deployed by signed digest, never by tag. ` +
      "Instead, reference it as name@sha256:<digest> from the release lock.",
  );
}

// Idea records: the outcome is written by `harness outcome record`, never typed
// into an idea by hand (ADR 0079). Audit mode (warn) first, per ADR 0080.
const IDEA_PATH = /^docs\/ideas\/[^/]+\.md$/;
const HAND_WRITTEN_OUTCOME = /^(?:#{1,6}[ \t]+outcome\b|outcome:)/im;

const ideaOutcomeWarn = (path: string): Finding =>
  warn(
    "idea-outcome",
    `${path} is an idea record: its outcome is written by the outcome tool, never by hand. ` +
      "Instead, run `harness outcome record --idea <number or slug> --kind <experiment|usage|verification> --source <live-run|journal|eval-history|comparison> --evidence <reference> --result <confirmed|refuted|inconclusive> --summary <text>`.",
  );

async function checkCoverageThreshold(
  tool: string,
  input: Input,
  relative: string,
  ctx: GuardContext,
): Promise<Finding> {
  if (relative !== "tools/kore/vitest.config.ts") {
    return null;
  }
  const previous = await before(tool, input, relative, ctx, false);
  if (!lowersThresholds(previous, written(tool, input))) {
    return null;
  }
  return block(
    "coverage-threshold",
    "Coverage thresholds only go up. " +
      "Instead, add tests for the uncovered code and leave the thresholds unchanged.",
  );
}

async function checkSopsPath(
  tool: string,
  input: Input,
  relative: string,
  ctx: GuardContext,
): Promise<Finding> {
  const patterns = await loadSopsPatterns(ctx);
  if (!patterns.some((pattern) => pattern.test(relative))) {
    return null;
  }
  const encrypted = tool === "Write" && /^sops:/m.test(text(input["content"]));
  return encrypted ? null : sopsBlock(relative);
}

async function checkWrite(
  tool: string,
  input: Input,
  relative: string,
  ctx: GuardContext,
): Promise<Verdict> {
  if (isAppendOnly(relative)) {
    return applyMode(appendOnlyWarn(relative), ctx) ?? allow;
  }
  const ideaOutcome =
    IDEA_PATH.test(relative) && HAND_WRITTEN_OUTCOME.test(written(tool, input))
      ? ideaOutcomeWarn(relative)
      : null;
  // Each finding takes its own rule's mode before they are weighed: a block wins over any warning.
  const findings = [
    await checkFlagOn(tool, input, relative, ctx),
    ideaOutcome,
    await checkSopsPath(tool, input, relative, ctx),
    await checkCoverageThreshold(tool, input, relative, ctx),
    checkImageDigest(tool, input, relative),
    checkGuardrailDemotion(
      tool,
      input,
      relative,
      relative === INVENTORY_PATH
        ? await before(tool, input, relative, ctx, false)
        : "",
    ),
  ]
    .map((finding) => applyMode(finding, ctx))
    .filter((finding): finding is Hit => finding !== null);
  const blocked = findings.find((finding) => finding.action === "block");
  if (blocked) {
    return blocked;
  }
  const [first, ...rest] = findings;
  return first
    ? {
        ...first,
        message: [first, ...rest].map((finding) => finding.message).join("\n"),
      }
    : allow;
}

export async function evaluateFile(
  tool: string,
  input: Input,
  relative: string,
  ctx: GuardContext,
): Promise<Verdict> {
  if (SECRET_PATH.test(relative)) {
    return applyMode(secretBlock(), ctx);
  }
  if (tool === "Read") {
    return allow;
  }
  return await checkWrite(tool, input, relative, ctx);
}
