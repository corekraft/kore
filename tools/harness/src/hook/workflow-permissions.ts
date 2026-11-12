// Signer guard: only the tag-gated signing jobs of release.yaml may hold
// `id-token: write` (keyless signing) or `packages: write` (registry push), and
// every job states its token permissions. Plan: infra/plans/2-implementation.md
// (Step 7), ADR 0044.

import { join } from "node:path";
import { CommandError, type FileSystem } from "../runtime/index.js";

const RELEASE = "release.yaml";
const SIGNING_JOBS = ["release", "mirror"];
const SIGNING_SCOPES = ["id-token", "packages"];
const TAG_GATE = "github.ref_type == 'tag'";
const PR_TRIGGERS = ["pull_request", "pull_request_target"];

type Node = { [key: string]: string | Node };

const isMap = (value: unknown): value is Node =>
  typeof value === "object" && value !== null;

type Frame = { indent: number; node: Node };

/** Files one `key: value` line under its parent, descending when the value is empty. Returns a block scalar's indent, else null. */
function addEntry(stack: Frame[], indent: number, body: string): number | null {
  const match = /^["']?([^:"']+)["']?:\s*(.*)$/.exec(body);
  if (!match) {
    return null;
  }
  const key = match[1] as string;
  while ((stack[stack.length - 1] as Frame).indent >= indent) {
    stack.pop();
  }
  const parent = (stack[stack.length - 1] as Frame).node;
  const value = (match[2] as string).trim();
  if (value === "") {
    const child: Node = {};
    parent[key] = child;
    stack.push({ indent, node: child });
    return null;
  }
  parent[key] = value;
  return /^[|>]/.test(value) ? indent : null;
}

/** Parse the block-mapping subset of workflow YAML into nested objects. List items and block scalars are skipped. */
export function parseWorkflow(text: string): Node {
  const rootNode: Node = {};
  const stack: Frame[] = [{ indent: -1, node: rootNode }];
  let skipAbove: number | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/(^|\s)#.*$/, "");
    const indent = line.length - line.trimStart().length;
    if (line.trim() === "" || (skipAbove !== null && indent > skipAbove)) {
      continue;
    }
    skipAbove = null;
    const body = line.trim();
    if (body.startsWith("-")) {
      skipAbove = indent - 1;
      continue;
    }
    skipAbove = addEntry(stack, indent, body);
  }
  return rootNode;
}

/** Scopes granted write by a permissions value, or null when it is absent. */
function writeScopes(permissions: string | Node | undefined): string[] | null {
  if (permissions === undefined) {
    return null;
  }
  if (isMap(permissions)) {
    return Object.entries(permissions)
      .filter(([, level]) => level === "write")
      .map(([scope]) => scope);
  }
  if (permissions === "write-all") {
    return ["write-all"];
  }
  return [...permissions.matchAll(/([\w-]+)\s*:\s*write\b/g)].map(
    (m) => m[1] as string,
  );
}

function triggers(on: string | Node | undefined): string[] {
  if (isMap(on)) {
    return Object.keys(on);
  }
  return String(on ?? "")
    .replace(/[[\]]/g, "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function jobProblems(file: string, name: string, job: unknown): string[] {
  const scopes = isMap(job) ? writeScopes(job["permissions"]) : null;
  if (scopes === null || !isMap(job)) {
    return [
      `${file}: job ${name} needs explicit permissions; add \`permissions: {}\` or the read scopes it uses`,
    ];
  }
  const isRelease = file === RELEASE;
  const signing = scopes.filter((s) => SIGNING_SCOPES.includes(s));
  const allowedSigner = isRelease && SIGNING_JOBS.includes(name);
  const problems: string[] = [];
  if (!allowedSigner) {
    for (const scope of signing) {
      problems.push(
        `${file}: job ${name} requests ${scope}: write; only the ${SIGNING_JOBS.join(" and ")} jobs of ${RELEASE} may sign or push, so drop it`,
      );
    }
  }
  const gate = job["if"];
  if (
    allowedSigner &&
    signing.length > 0 &&
    !(typeof gate === "string" && gate.includes(TAG_GATE))
  ) {
    problems.push(
      `${file}: signing job ${name} must run only for tags; add \`if: ${TAG_GATE}\``,
    );
  }
  if (!isRelease) {
    for (const scope of scopes.filter((s) => !SIGNING_SCOPES.includes(s))) {
      problems.push(
        `${file}: job ${name} requests ${scope}: write; only ${RELEASE} may write, so drop it`,
      );
    }
  }
  return problems;
}

function fileProblems(file: string, text: string): string[] {
  const workflow = parseWorkflow(text);
  const problems: string[] = [];
  const top = writeScopes(workflow["permissions"]);
  if (top === null || top.length > 0) {
    problems.push(
      `${file}: top-level permissions must be present and read-only; add \`permissions: {}\` or \`contents: read\``,
    );
  }
  const jobs = isMap(workflow["jobs"]) ? workflow["jobs"] : {};
  for (const [name, job] of Object.entries(jobs)) {
    problems.push(...jobProblems(file, name, job));
  }
  if (file === RELEASE) {
    const on = triggers(workflow["on"] ?? workflow["true"]);
    for (const trigger of on.filter((t) => PR_TRIGGERS.includes(t))) {
      problems.push(
        `${file}: must not run on ${trigger}; a pull request could mint a trusted signature, so remove the trigger`,
      );
    }
  }
  return problems;
}

/** Problems with the workflows' token permissions, each with its fix; empty when all are correct. `files` maps a workflow file name to its text. */
export function permissionProblems(files: Record<string, string>): string[] {
  return Object.entries(files).flatMap(([file, text]) =>
    fileProblems(file, text),
  );
}

/** Problems with the token permissions of every workflow under root's `.github/workflows`. */
export async function workflowProblems(
  fs: FileSystem,
  root: string,
): Promise<string[]> {
  const dir = join(root, ".github", "workflows");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CommandError(
        `No workflows directory at ${dir}. Run from the repository, or set CLAUDE_PROJECT_DIR to its root.`,
      );
    }
    throw error;
  }
  const files: Record<string, string> = {};
  for (const entry of entries.filter((f) => /\.ya?ml$/.test(f)).sort()) {
    files[entry] = await fs.readFile(join(dir, entry));
  }
  return permissionProblems(files);
}
