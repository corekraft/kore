import { join } from "node:path";
import type { CliDeps } from "../runtime/index.js";

/** One role's definition as claude's --agents takes it: the frontmatter's fields and the body as the prompt. */
export interface AgentEntry {
  readonly description: string;
  readonly prompt: string;
  readonly tools?: readonly string[];
  readonly model?: string;
  readonly effort?: string;
}

/** The outcome of reading a role's definition: its --agents JSON, or a refusal to print. */
export type AgentOutcome =
  | { readonly ok: true; readonly json: string }
  | { readonly ok: false; readonly message: string };

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;
const ROLE = /^[a-z][a-z0-9-]*$/;

/** A frontmatter line's value, without surrounding quotes; undefined when the key is absent or empty. */
function scalar(frontmatter: string, key: string): string | undefined {
  const prefix = `${key}:`;
  const line = frontmatter
    .split("\n")
    .find((candidate) => candidate.startsWith(prefix));
  const value = line?.slice(prefix.length).trim();
  return value === undefined || value === ""
    ? undefined
    : value.replace(/^(["'])(.*)\1$/, "$2");
}

/**
 * Builds the entry from a definition file: its description, tools, model and effort
 * from the frontmatter, and the body as the prompt. Undefined when there is no
 * frontmatter or no description, since claude cannot start the role without one.
 */
export function parseAgentEntry(markdown: string): AgentEntry | undefined {
  const match = FRONTMATTER.exec(markdown);
  if (match === null) {
    return undefined;
  }
  const frontmatter = match[1] ?? "";
  const description = scalar(frontmatter, "description");
  if (description === undefined) {
    return undefined;
  }
  const tools = scalar(frontmatter, "tools")
    ?.split(",")
    .map((tool) => tool.trim())
    .filter((tool) => tool !== "");
  const model = scalar(frontmatter, "model");
  const effort = scalar(frontmatter, "effort");
  return {
    description,
    prompt: (match[2] ?? "").trim(),
    ...(tools === undefined ? {} : { tools }),
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  };
}

/** claude's --agents value for one role: a JSON object keyed by the role's name. */
export function agentsJson(role: string, entry: AgentEntry): string {
  return JSON.stringify({ [role]: entry });
}

/**
 * Reads the role's definition from the main checkout's .claude/agents, never a
 * worktree's, and returns the --agents JSON for it. A role name that could point
 * outside that directory, a missing file, or a file with no description is refused
 * with a message naming it; any other read error is rethrown.
 */
export async function readRoleAgent(
  deps: Pick<CliDeps, "fs">,
  main: string,
  role: string,
): Promise<AgentOutcome> {
  if (!ROLE.test(role)) {
    return {
      ok: false,
      message: `${role} is not a role name: session exec reads the role's definition from .claude/agents/<role>.md, so a role is lowercase letters, digits and hyphens. Rerun with a defined role. Nothing was started.\n`,
    };
  }
  const path = join(main, ".claude", "agents", `${role}.md`);
  let markdown: string;
  try {
    markdown = await deps.fs.readFile(path);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "ENOENT") {
      return {
        ok: false,
        message: `The ${role} role has no agent definition: ${path} was not found in the main checkout ${main}. Add it there, then rerun. Nothing was started.\n`,
      };
    }
    throw error;
  }
  const entry = parseAgentEntry(markdown);
  return entry === undefined
    ? {
        ok: false,
        message: `${path} has no description in its frontmatter, which claude needs to start the ${role} role. Add a description: line there, then rerun. Nothing was started.\n`,
      }
    : { ok: true, json: agentsJson(role, entry) };
}
