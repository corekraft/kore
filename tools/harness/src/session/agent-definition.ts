import { join } from "node:path";
import type { CliDeps } from "../runtime/index.js";

/** The launch settings an agent definition's frontmatter declares. */
export interface Definition {
  model?: string;
  effort?: string;
  tools?: string[];
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---/;

function field(frontmatter: string, key: string): string | undefined {
  const line = frontmatter.split("\n").find((l) => l.startsWith(`${key}:`));
  const value = line?.slice(key.length + 1).trim();
  return value === undefined || value === ""
    ? undefined
    : value.replace(/^(["'])(.*)\1$/, "$2");
}

/** Reads model, effort and tools from a definition's frontmatter; never throws on malformed content. */
export function parseDefinition(markdown: string): Definition {
  const frontmatter = FRONTMATTER.exec(markdown)?.[1] ?? "";
  const model = field(frontmatter, "model");
  const effort = field(frontmatter, "effort");
  const tools = field(frontmatter, "tools");
  return {
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(tools === undefined
      ? {}
      : { tools: tools.split(",").map((tool) => tool.trim()) }),
  };
}

const ROLE = /^[a-z][a-z0-9-]*$/;

/**
 * The tier a role's definition declares, the one place a role's model and
 * effort live (ADR 0078). Empty when the role has no definition file or its
 * name could point outside the agents directory.
 */
export async function readTier(
  deps: CliDeps,
  role: string,
): Promise<Definition> {
  if (!ROLE.test(role)) {
    return {};
  }
  const path = join(await deps.root(), ".claude/agents", `${role}.md`);
  try {
    return parseDefinition(await deps.fs.readFile(path));
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

/**
 * The model and effort to launch a role at: an explicit flag wins, which is
 * how a writer escalates; otherwise the definition's frontmatter. An error
 * names the missing setting and the file to fix.
 */
export async function resolveTier(
  deps: CliDeps,
  role: string,
  flags: { model?: string | undefined; effort?: string | undefined },
): Promise<{ model: string; effort: string } | { error: string }> {
  const declared = await readTier(deps, role);
  const model = flags.model ?? declared.model;
  const effort = flags.effort ?? declared.effort;
  for (const [flag, value] of [
    ["model", model],
    ["effort", effort],
  ] as const) {
    if (value === undefined) {
      return {
        error: `Missing --${flag}, and .claude/agents/${role}.md does not declare it. Pass --${flag} or add \`${flag}:\` to that definition's frontmatter.`,
      };
    }
  }
  return { model: model as string, effort: effort as string };
}

/**
 * The refusal for a role with no agent definition, naming the roles that have
 * one; undefined when the role is defined. Without a definition a caller could
 * pick any model by flag, so no session starts.
 */
export async function undefinedRoleError(
  deps: CliDeps,
  role: string,
): Promise<string | undefined> {
  const files = await deps.fs.readdir(
    join(await deps.root(), ".claude/agents"),
  );
  const roles = files
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -3))
    .sort();
  return roles.includes(role)
    ? undefined
    : `Role ${role} has no agent definition, so no session starts. The defined roles are ${roles.join(", ")}; brief a verifier or fixer as a reader or a writer.`;
}
