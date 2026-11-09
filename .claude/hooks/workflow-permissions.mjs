// Signer guard: only the tag-gated signing jobs of release.yaml may hold
// `id-token: write` (keyless signing) or `packages: write` (registry push), and
// every job states its token permissions. Plan: infra/plans/2-implementation.md
// (Step 7), ADR 0044. Node standard library only.

const RELEASE = "release.yaml";
const SIGNING_JOBS = ["release", "mirror"];
const SIGNING_SCOPES = ["id-token", "packages"];
const TAG_GATE = "github.ref_type == 'tag'";
const PR_TRIGGERS = ["pull_request", "pull_request_target"];

/** Parse the block-mapping subset of workflow YAML into nested objects. List items and block scalars are skipped. */
export function parseWorkflow(text) {
  const rootNode = {};
  const stack = [{ indent: -1, node: rootNode }];
  let skipAbove = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/(^|\s)#.*$/, "");
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    if (skipAbove !== null) {
      if (indent > skipAbove) continue;
      skipAbove = null;
    }
    const body = line.trim();
    if (body.startsWith("-")) {
      skipAbove = indent - 1;
      continue;
    }
    const match = /^["']?([^:"']+)["']?:\s*(.*)$/.exec(body);
    if (!match) continue;
    while (stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    const value = match[2].trim();
    if (value === "") {
      const child = {};
      parent[match[1]] = child;
      stack.push({ indent, node: child });
    } else {
      parent[match[1]] = value;
      if (/^[|>]/.test(value)) skipAbove = indent;
    }
  }
  return rootNode;
}

const isMap = (v) => typeof v === "object" && v !== null;

/** Scopes granted write by a permissions value, or null when it is absent. */
function writeScopes(permissions) {
  if (permissions === undefined) return null;
  if (isMap(permissions)) {
    return Object.entries(permissions)
      .filter(([, level]) => level === "write")
      .map(([scope]) => scope);
  }
  if (permissions === "write-all") return ["write-all"];
  return [...permissions.matchAll(/([\w-]+)\s*:\s*write\b/g)].map((m) => m[1]);
}

function triggers(on) {
  if (isMap(on)) return Object.keys(on);
  return String(on ?? "")
    .replace(/[[\]]/g, "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Problems with the workflows' token permissions, each with its fix; empty when all are correct. `files` maps a workflow file name to its text. */
export function permissionProblems(files) {
  const problems = [];
  for (const [file, text] of Object.entries(files)) {
    const workflow = parseWorkflow(text);
    const isRelease = file === RELEASE;
    const top = writeScopes(workflow.permissions);
    if (top === null || top.length > 0) {
      problems.push(
        `${file}: top-level permissions must be present and read-only; add \`permissions: {}\` or \`contents: read\``,
      );
    }
    const on = triggers(workflow.on ?? workflow["true"]);
    const jobs = isMap(workflow.jobs) ? workflow.jobs : {};
    for (const [name, job] of Object.entries(jobs)) {
      const scopes = isMap(job) ? writeScopes(job.permissions) : null;
      if (scopes === null) {
        problems.push(
          `${file}: job ${name} needs explicit permissions; add \`permissions: {}\` or the read scopes it uses`,
        );
        continue;
      }
      const signing = scopes.filter((s) => SIGNING_SCOPES.includes(s));
      const allowedSigner = isRelease && SIGNING_JOBS.includes(name);
      for (const scope of signing) {
        if (!allowedSigner) {
          problems.push(
            `${file}: job ${name} requests ${scope}: write; only the ${SIGNING_JOBS.join(" and ")} jobs of ${RELEASE} may sign or push, so drop it`,
          );
        }
      }
      if (allowedSigner && signing.length > 0) {
        if (!String(job.if ?? "").includes(TAG_GATE)) {
          problems.push(
            `${file}: signing job ${name} must run only for tags; add \`if: ${TAG_GATE}\``,
          );
        }
      }
      if (!isRelease) {
        for (const scope of scopes.filter((s) => !SIGNING_SCOPES.includes(s))) {
          problems.push(
            `${file}: job ${name} requests ${scope}: write; only ${RELEASE} may write, so drop it`,
          );
        }
      }
    }
    if (isRelease) {
      for (const trigger of on.filter((t) => PR_TRIGGERS.includes(t))) {
        problems.push(
          `${file}: must not run on ${trigger}; a pull request could mint a trusted signature, so remove the trigger`,
        );
      }
    }
  }
  return problems;
}
