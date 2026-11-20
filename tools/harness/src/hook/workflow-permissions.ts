// Signer guard: only the signing jobs of release.yaml may hold `id-token: write`
// (keyless signing) or `packages: write` (registry push), and every job states
// its token permissions. release, mirror and charts sign on a tag; charts-main
// signs on main (ADR 0138). Each signing job must carry its own exact `if:`, so
// a condition that ORs in another ref is refused. The one exception is the
// nightly failure-issue job, which opens or closes the integration tier's issue
// (#419). Plan: infra/plans/2-implementation.md (Step 7), ADR 0044, ADR 0138.

import { join } from "node:path";
import { CommandError, type FileSystem } from "../runtime/index.js";

const RELEASE = "release.yaml";
const SIGNING_SCOPES = ["id-token", "packages"];
const TAG_GATE = "github.ref_type == 'tag'";
const MAIN_GATE = "github.ref == 'refs/heads/main'";
const PR_TRIGGERS = ["pull_request", "pull_request_target"];

/** The signing jobs of release.yaml, each with the one exact `if:` it must carry and the ref it runs on. */
const SIGNING_JOBS = new Map<string, { gate: string; runsOn: string }>([
  ["release", { gate: TAG_GATE, runsOn: "tags" }],
  ["mirror", { gate: TAG_GATE, runsOn: "tags" }],
  ["charts", { gate: TAG_GATE, runsOn: "tags" }],
  ["charts-main", { gate: MAIN_GATE, runsOn: "main" }],
]);
const SIGNING_JOB_NAMES = [...SIGNING_JOBS.keys()];

/** The one job outside release.yaml that may hold a write scope: exactly these scopes, after the integration job, on the scheduled main run (ADR 0044). */
const ISSUE_JOB = {
  file: "nightly.yml",
  name: "failure-issue",
  needs: "integration",
  gate: "always() && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'",
  permissions: { issues: "write", actions: "read", contents: "read" },
} as const;

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

/** A plain `if:` value whose deeper-indented continuation lines are still open: GitHub joins them into the condition. */
type OpenIf = { indent: number; node: Node };

/** Parse the block-mapping subset of workflow YAML into nested objects. List items and block scalars are skipped. A deeper-indented line after a plain `if:` value is joined onto it with a newline (GitHub joins such lines into the condition), so the gate check sees the whole condition and refuses one that spans lines. */
export function parseWorkflow(text: string): Node {
  const rootNode: Node = {};
  const stack: Frame[] = [{ indent: -1, node: rootNode }];
  let skipAbove: number | null = null;
  let openIf: OpenIf | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/(^|\s)#.*$/, "");
    const indent = line.length - line.trimStart().length;
    if (line.trim() === "" || (skipAbove !== null && indent > skipAbove)) {
      continue;
    }
    const body = line.trim();
    if (openIf !== null && indent > openIf.indent) {
      const first = openIf.node["if"];
      openIf.node["if"] = `${typeof first === "string" ? first : ""}\n${body}`;
      continue;
    }
    openIf = null;
    skipAbove = null;
    if (body.startsWith("-")) {
      skipAbove = indent - 1;
      continue;
    }
    skipAbove = addEntry(stack, indent, body);
    const top = stack[stack.length - 1];
    if (
      skipAbove === null &&
      top !== undefined &&
      /^["']?if["']?:\s*\S/.test(body)
    ) {
      openIf = { indent, node: top.node };
    }
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
  if (permissions === "read-all") {
    return [];
  }
  if (!permissions.trimStart().startsWith("{")) {
    // A scalar GitHub reads as one blanket level (`write-all`, or a bare `write`):
    // no read-only reading of it exists, so it counts as a write (fail closed).
    return [permissions];
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

/** The named nightly job's problems: its exact permission map, and its wait for integration and its gate. */
function issueJobProblems(file: string, job: Node): string[] {
  const requested = isMap(job["permissions"]) ? job["permissions"] : {};
  const want = Object.entries(ISSUE_JOB.permissions);
  const exact =
    Object.keys(requested).length === want.length &&
    want.every(([scope, level]) => requested[scope] === level);
  const problems: string[] = [];
  if (!exact) {
    const declared = job["permissions"];
    const got =
      typeof declared === "string"
        ? declared
        : Object.entries(requested)
            .map(([scope, level]) =>
              typeof level === "string" ? `${scope}: ${level}` : scope,
            )
            .join(", ");
    const expected = want.map(([scope, level]) => `${scope}: ${level}`);
    problems.push(
      `${file}: job ${ISSUE_JOB.name} requests ${got || "no scope"}; it must request exactly ${expected.join(", ")}, so drop the rest`,
    );
  }
  if (job["needs"] !== ISSUE_JOB.needs) {
    problems.push(
      `${file}: job ${ISSUE_JOB.name} must wait for the ${ISSUE_JOB.needs} job; add \`needs: ${ISSUE_JOB.needs}\``,
    );
  }
  if (job["if"] !== ISSUE_JOB.gate) {
    problems.push(
      `${file}: job ${ISSUE_JOB.name} must run on the scheduled main run, after a failure or success; add \`if: ${ISSUE_JOB.gate}\``,
    );
  }
  return problems;
}

function jobProblems(file: string, name: string, job: unknown): string[] {
  if (file === ISSUE_JOB.file && name === ISSUE_JOB.name && isMap(job)) {
    return issueJobProblems(file, job);
  }
  const scopes = isMap(job) ? writeScopes(job["permissions"]) : null;
  if (scopes === null || !isMap(job)) {
    return [
      `${file}: job ${name} needs explicit permissions; add \`permissions: {}\` or the read scopes it uses`,
    ];
  }
  const isRelease = file === RELEASE;
  const signing = scopes.filter((s) => SIGNING_SCOPES.includes(s));
  const signer = isRelease ? SIGNING_JOBS.get(name) : undefined;
  const problems: string[] = [];
  if (signer === undefined) {
    for (const scope of signing) {
      problems.push(
        `${file}: job ${name} requests ${scope}: write; only the ${SIGNING_JOB_NAMES.slice(0, -1).join(", ")} and ${SIGNING_JOB_NAMES[SIGNING_JOB_NAMES.length - 1]} jobs of ${RELEASE} may sign or push, so drop it`,
      );
    }
  }
  const condition = job["if"];
  if (signer !== undefined && signing.length > 0 && condition !== signer.gate) {
    problems.push(
      typeof condition === "string" && condition.includes("\n")
        ? `${file}: signing job ${name} must run only for ${signer.runsOn}; its if: spans more than one line, and the gate must be one line equal to the exact condition, so write \`if: ${signer.gate}\` on one line`
        : `${file}: signing job ${name} must run only for ${signer.runsOn}; add \`if: ${signer.gate}\``,
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
