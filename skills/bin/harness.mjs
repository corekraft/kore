// src/runtime/errors.ts
var CommandError = class extends Error {
};

// src/runtime/clock.ts
var systemClock = {
  now: () => /* @__PURE__ */ new Date(),
  sleep: (ms) => new Promise((resolve10) => setTimeout(resolve10, ms))
};
function localDate(date) {
  const two = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

// src/runtime/ids.ts
import { randomUUID } from "node:crypto";
var systemIds = {
  next: () => randomUUID()
};

// src/runtime/filesystem.ts
import {
  appendFile,
  mkdir,
  readFile,
  open,
  readdir,
  rm,
  readlink,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname } from "node:path";
var nodeFileSystem = {
  readFile: (path) => readFile(path, "utf8"),
  async writeFile(path, content) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  },
  async createFile(path, content) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { flag: "wx" });
  },
  async appendFile(path, content) {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, content);
  },
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  },
  readdir: (path) => readdir(path),
  remove: (path) => rm(path, { force: true }),
  readlink: (path) => readlink(path),
  async mtimeMs(path) {
    return (await stat(path)).mtimeMs;
  },
  async isDirectory(path) {
    try {
      return (await stat(path)).isDirectory();
    } catch (error) {
      if (error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  },
  async readHead(path, bytes) {
    const file = await open(path, "r");
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await file.read(buffer, 0, bytes, 0);
      return buffer.toString("utf8", 0, bytesRead);
    } finally {
      await file.close();
    }
  },
  async readFrom(path, offset) {
    const file = await open(path, "r");
    try {
      const { size } = await file.stat();
      if (offset >= size) {
        return "";
      }
      const buffer = Buffer.alloc(size - offset);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      return buffer.toString("utf8", 0, bytesRead);
    } finally {
      await file.close();
    }
  }
};

// src/runtime/runner.ts
import { spawn } from "node:child_process";
var ProcessRunner = class {
  async run(command, args, options = {}) {
    return await new Promise((resolve10) => {
      const child = spawn(command, [...args], {
        ...options.cwd === void 0 ? {} : { cwd: options.cwd },
        stdio: [
          options.input === void 0 ? "ignore" : "pipe",
          "pipe",
          "pipe"
        ]
      });
      let stdout = "";
      let stderr2 = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr2 += chunk.toString();
      });
      child.on("error", (error) => {
        resolve10({ stdout, stderr: error.message, code: 127 });
      });
      child.on("close", (code) => {
        resolve10({ stdout, stderr: stderr2, code: code ?? 1 });
      });
      if (options.input !== void 0) {
        child.stdin?.end(options.input);
      }
    });
  }
};

// src/runtime/main-root.ts
import { dirname as dirname2, resolve } from "node:path";
async function mainRoot(deps) {
  const checkout = await deps.root().catch(() => void 0);
  const override = deps.env["KORE_ROOT"];
  if (override !== void 0 && override !== "") {
    return resolve(deps.cwd, override);
  }
  if (checkout === void 0) {
    return void 0;
  }
  const git3 = await deps.runner.run(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: checkout }
  );
  const common = git3.stdout.trim();
  return git3.code === 0 && common !== "" ? dirname2(common) : void 0;
}

// src/runtime/root.ts
import { dirname as dirname3, join, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";
var PLANS = "infra/plans";
async function resolveRoot(env, moduleUrl, exists) {
  const fromEnv = env.CLAUDE_PROJECT_DIR;
  if (fromEnv !== void 0 && fromEnv !== "") {
    if (await exists(join(fromEnv, PLANS))) {
      return fromEnv;
    }
    throw new CommandError(
      `CLAUDE_PROJECT_DIR is "${fromEnv}" but it has no ${PLANS}. Point it at the repository root or unset it.`
    );
  }
  const bundle = fileURLToPath(moduleUrl);
  const root3 = resolve2(dirname3(bundle), "../..");
  if (await exists(join(root3, PLANS))) {
    return root3;
  }
  throw new CommandError(
    `Cannot find the repo root: ${bundle} is not at <root>/skills/bin and CLAUDE_PROJECT_DIR is unset. Run the committed skills/bin/harness.mjs or set CLAUDE_PROJECT_DIR to the repository root.`
  );
}

// src/runtime/stdin.ts
async function readStdin(stream) {
  if (stream.isTTY === true) {
    return "";
  }
  const parts = [];
  for await (const chunk of stream) {
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts).toString("utf8");
}

// package.json
var package_default = {
  name: "@corekraft/harness",
  version: "0.1.0",
  private: true,
  description: "Agent harness tools: one bundled CLI that skills and hooks call",
  type: "module",
  scripts: {
    build: "esbuild src/main.ts --bundle --platform=node --format=esm --target=node26 --legal-comments=none --outfile=../../skills/bin/harness.mjs",
    check: "tsc -p tsconfig.json --noEmit",
    format: 'prettier --write "src/**/*.ts" "tests/**/*.ts" package.json tsconfig.json .oxlintrc.json .prettierrc.json vitest.config.ts',
    "format:check": 'prettier --check "src/**/*.ts" "tests/**/*.ts" package.json tsconfig.json .oxlintrc.json .prettierrc.json vitest.config.ts',
    lint: "oxlint --type-aware --deny-warnings src tests",
    test: "vitest run --coverage",
    "test:unit": "vitest run",
    "test:related": "vitest related --run --passWithNoTests --maxWorkers=2",
    "test:hooks": "vitest run .claude/"
  },
  devDependencies: {
    "@types/node": "26.6.6",
    "@vitest/coverage-v8": "5.1.0",
    esbuild: "0.28.2",
    oxlint: "1.92.0",
    "oxlint-tsgolint": "7.0.2006",
    prettier: "3.9.10",
    typescript: "7.0.2",
    vitest: "5.1.0"
  },
  engines: {
    node: ">=26.8.2"
  }
};

// src/adr/adr.ts
var DECISIONS = "docs/decisions";
var INDEX = "docs/index.md";
var STATUSES = ["proposed", "accepted"];
var AdrError = class extends Error {
};
function kebab(title) {
  const slug2 = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug2 === "") {
    throw new AdrError(
      "--title needs at least one letter or digit; give the decision a short name."
    );
  }
  return slug2;
}
function checkSummary(summary) {
  if (summary.includes("\n") || /^[[{|>&*!-]/.test(summary)) {
    throw new AdrError(
      "--summary must be one plain line that does not start with [ { | > & * ! or -; reword it as a sentence."
    );
  }
}
function headingSlug(heading) {
  return heading.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-");
}
function headings(markdown) {
  const seen = /* @__PURE__ */ new Map();
  const found = [];
  let fence = null;
  for (const line2 of markdown.split("\n")) {
    const opener = /^\s*(```|~~~)/.exec(line2)?.[1] ?? null;
    if (fence !== null || opener !== null) {
      fence = opener === fence ? null : fence ?? opener;
      continue;
    }
    const text9 = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line2)?.[1];
    if (text9 === void 0) {
      continue;
    }
    const base = headingSlug(text9);
    const count3 = seen.get(base) ?? 0;
    seen.set(base, count3 + 1);
    found.push({ text: text9, anchor: count3 > 0 ? `${base}-${count3}` : base });
  }
  return found;
}
function adrNumber(file) {
  const match = /^(\d{4})-.+\.md$/.exec(file);
  return match?.[1] === void 0 ? null : Number(match[1]);
}
var Adrs = class {
  constructor(fs, clock, root3) {
    this.fs = fs;
    this.clock = clock;
    this.root = root3;
  }
  fs;
  clock;
  root;
  async create(input, dryRun) {
    this.checkStatus(input.status);
    checkSummary(input.summary);
    const slug2 = kebab(input.title);
    const next = Math.max(
      0,
      ...(await this.fs.readdir(this.abs(DECISIONS))).map(
        (f) => adrNumber(f) ?? 0
      )
    ) + 1;
    const number = String(next).padStart(4, "0");
    const file = `${number}-${slug2}.md`;
    const path = `${DECISIONS}/${file}`;
    const indexText = await this.readIndex();
    const date = localDate(this.clock.now());
    const body = [
      "---",
      `status: ${input.status}`,
      `summary: ${input.summary}`,
      `date: ${date}`,
      `last-verified: ${date}`,
      "---",
      "",
      `# ADR ${number}: ${input.title}`,
      "",
      `Source: ${await this.source(input.source)}`,
      ...input.refines === void 0 ? [] : ["", `Refines: ${input.refines}`],
      "",
      "## Context",
      "",
      "## Decision",
      "",
      "## Consequences",
      ""
    ];
    const entry2 = `- [\`${path}\`](decisions/${file}) \u2014 ${input.summary}`;
    const index = this.insert(indexText, next, entry2);
    const report3 = {
      dryRun,
      number,
      files: [
        {
          path,
          lines: body.slice(0, -1).map((text9, i) => ({ number: i + 1, text: text9 }))
        },
        { path: INDEX, lines: [{ number: index.line, text: entry2 }] }
      ]
    };
    if (!dryRun) {
      await this.fs.writeFile(this.abs(path), body.join("\n"));
      await this.fs.writeFile(this.abs(INDEX), index.text);
    }
    return report3;
  }
  async readIndex() {
    if (!await this.fs.exists(this.abs(INDEX))) {
      throw new AdrError(`${INDEX} is missing; restore it from git.`);
    }
    return this.fs.readFile(this.abs(INDEX));
  }
  /** Puts the entry before the first later-numbered ADR line, else after the last one. */
  insert(text9, next, entry2) {
    const lines2 = text9.split("\n");
    const start = lines2.indexOf("## Decisions");
    if (start === -1) {
      throw new AdrError(
        `${INDEX} has no "## Decisions" heading; add it above the ADR entries.`
      );
    }
    let end = lines2.findIndex((l, i) => i > start && l.startsWith("## "));
    if (end === -1) {
      end = lines2.length;
    }
    const at = this.position(lines2, start, end, next);
    lines2.splice(at, 0, entry2);
    return { text: lines2.join("\n"), line: at + 1 };
  }
  /** Index of the line to insert at: before the first later ADR entry, else after the last. */
  position(lines2, start, end, next) {
    let last = -1;
    for (let i = start + 1; i < end; i++) {
      const n = /\]\(decisions\/(\d{4})-/.exec(lines2[i] ?? "")?.[1];
      if (n === void 0) {
        continue;
      }
      if (Number(n) > next) {
        return i;
      }
      last = i;
    }
    if (last !== -1) {
      return last + 1;
    }
    let tail = end - 1;
    while (tail > start && lines2[tail] === "") {
      tail--;
    }
    return tail + 1;
  }
  abs(path) {
    return `${this.root}/${path}`;
  }
  checkStatus(status2) {
    if (status2 === "superseded") {
      throw new AdrError(
        "--status superseded cannot be written by adr new, which has no superseded-by to record; create the ADR as proposed or accepted, then run `harness adr supersede`."
      );
    }
    if (!STATUSES.includes(status2)) {
      throw new AdrError(
        `--status is "${status2}"; use one of ${STATUSES.join(", ")}.`
      );
    }
  }
  /** The Source link: the plan must exist and, with an anchor, so must its heading. */
  async source(value) {
    const [path = "", anchor] = value.split("#", 2);
    if (!await this.fs.exists(this.abs(path))) {
      throw new AdrError(
        `--source ${path} does not exist; use a plan path from the repository root, e.g. infra/plans/<plan>.md#<heading-slug>.`
      );
    }
    if (anchor === void 0) {
      return `[\`${path}\`](../../${path})`;
    }
    const known = headings(await this.fs.readFile(this.abs(path)));
    const hit = known.find((h) => h.anchor === anchor.toLowerCase());
    if (hit === void 0) {
      const slugs = known.slice(0, 5).map((h) => `#${h.anchor}`).join(", ");
      throw new AdrError(
        `--source #${anchor} is not a heading in ${path}; use one of its heading slugs: ${slugs}.`
      );
    }
    const label = hit.text.split(":", 1)[0]?.trim() ?? hit.text;
    return `[\`${path}\` \xA7 ${label}](../../${path}#${anchor})`;
  }
};

// src/adr/supersede.ts
function parseNumber(flag, value) {
  if (!/^\d{1,4}$/.test(value)) {
    throw new AdrError(
      `--${flag} must be an ADR number such as 12 or 0012; got "${value}".`
    );
  }
  return value.padStart(4, "0");
}
function frontmatterLine(lines2, key) {
  if (lines2[0] !== "---") {
    return -1;
  }
  const close3 = lines2.indexOf("---", 1);
  const end = close3 === -1 ? lines2.length : close3;
  return lines2.findIndex((l, i) => i > 0 && i < end && l.startsWith(`${key}:`));
}
var Supersession = class {
  constructor(fs, root3) {
    this.fs = fs;
    this.root = root3;
  }
  fs;
  root;
  async supersede(oldFlag, newFlag, dryRun) {
    const old = parseNumber("old", oldFlag);
    const next = parseNumber("new", newFlag);
    if (old === next) {
      throw new AdrError(
        `ADR ${old} cannot supersede itself; pass the replacing ADR's number as --new.`
      );
    }
    const oldAdr = await this.find(old, false);
    const newAdr2 = await this.find(next, true);
    const oldStatus = this.status(oldAdr);
    if (oldStatus === "superseded") {
      throw new AdrError(this.alreadySuperseded(old, next, oldAdr));
    }
    if (frontmatterLine(oldAdr.lines, "superseded-by") !== -1) {
      throw new AdrError(
        `${oldAdr.path} already has superseded-by although its status is ${oldStatus}; fix the frontmatter by hand.`
      );
    }
    if (this.status(newAdr2) === "superseded") {
      throw new AdrError(
        `ADR ${next} is itself superseded; use the ADR that replaced it as --new.`
      );
    }
    const changed = ["status: superseded", `superseded-by: ${newAdr2.path}`];
    const lines2 = [
      ...oldAdr.lines.slice(0, oldAdr.statusLine),
      ...changed,
      ...oldAdr.lines.slice(oldAdr.statusLine + 1)
    ];
    if (!dryRun) {
      await this.fs.writeFile(this.abs(oldAdr.path), lines2.join("\n"));
    }
    return {
      dryRun,
      old,
      new: next,
      files: [
        {
          path: oldAdr.path,
          lines: changed.map((text9, i) => ({
            number: oldAdr.statusLine + 1 + i,
            text: text9
          }))
        }
      ]
    };
  }
  alreadySuperseded(old, next, adr) {
    const line2 = frontmatterLine(adr.lines, "superseded-by");
    const current = (adr.lines[line2] ?? "").slice("superseded-by:".length).trim();
    const chained = /(\d{4})-[^/]*\.md$/.exec(current)?.[1];
    if (chained === void 0) {
      return `ADR ${old} is already superseded; fix its superseded-by line by hand.`;
    }
    return `ADR ${old} is already superseded by ${current}; to replace that ADR instead, run \`harness adr supersede --old ${chained} --new ${next}\`.`;
  }
  status(adr) {
    return (adr.lines[adr.statusLine] ?? "").slice("status:".length).trim();
  }
  async find(number, replacement) {
    const matches3 = (await this.fs.readdir(this.abs(DECISIONS))).filter(
      (f) => f.startsWith(`${number}-`) && f.endsWith(".md") && f.length > number.length + 4
    ).sort();
    if (matches3.length > 1) {
      throw new AdrError(
        `ADR ${number} matches more than one file: ${matches3.map((f) => `${DECISIONS}/${f}`).join(", ")}; renumber one so each ADR number is unique, then retry.`
      );
    }
    const file = matches3[0];
    if (file === void 0) {
      throw new AdrError(
        `ADR ${number} does not exist; ${replacement ? "create it first with `harness adr new`" : "check the number against docs/decisions/"}.`
      );
    }
    const path = `${DECISIONS}/${file}`;
    const lines2 = (await this.fs.readFile(this.abs(path))).split("\n");
    const statusLine2 = frontmatterLine(lines2, "status");
    if (statusLine2 === -1) {
      throw new AdrError(
        `${path} has no frontmatter status; add a "status:" line before superseding it.`
      );
    }
    return { path, lines: lines2, statusLine: statusLine2 };
  }
  abs(path) {
    return `${this.root}/${path}`;
  }
};

// src/adr/commands.ts
var REQUIRED = ["title", "summary", "status", "source"];
function describe(report3) {
  const verb = report3.dryRun ? "Would write" : "Wrote";
  return `${report3.files.map(
    (f) => `${verb} ${f.path} (lines ${f.lines[0]?.number}-${f.lines.at(-1)?.number})`
  ).join("\n")}
`;
}
function requiredFlag(options, key, hint) {
  const v = options[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new AdrError(`--${key} is required; pass --${key} <${hint}>.`);
  }
  return v.trim();
}
function repoRoot(deps) {
  return deps.root().catch((cause) => {
    throw new AdrError(cause instanceof Error ? cause.message : String(cause));
  });
}
async function withAdrErrors(json, deps, body) {
  try {
    return await body();
  } catch (error) {
    if (!(error instanceof AdrError)) {
      throw error;
    }
    deps.stderr(
      json ? `${JSON.stringify({ error: error.message })}
` : `${error.message}
`
    );
    return 1;
  }
}
var newAdr = {
  summary: "create the next ADR and its index entry (--title --summary --status --source [--refines] [--dry-run])",
  options: {
    title: "string",
    summary: "string",
    status: "string",
    source: "string",
    refines: "string",
    "dry-run": "boolean"
  },
  run: ({ json, options, deps }) => withAdrErrors(json, deps, async () => {
    const [title, summary, status2, source] = REQUIRED.map(
      (key) => requiredFlag(options, key, "text")
    );
    const refines = typeof options["refines"] === "string" ? options["refines"].trim() : void 0;
    const root3 = await repoRoot(deps);
    const report3 = await new Adrs(deps.fs, deps.clock, root3).create(
      { title, summary, status: status2, source, ...refines ? { refines } : {} },
      options["dry-run"] === true
    );
    deps.stdout(json ? `${JSON.stringify(report3)}
` : describe(report3));
    return 0;
  })
};
var supersede = {
  summary: "mark an ADR superseded by another (--old N --new M [--dry-run])",
  options: { old: "string", new: "string", "dry-run": "boolean" },
  run: ({ json, options, deps }) => withAdrErrors(json, deps, async () => {
    const root3 = await repoRoot(deps);
    const report3 = await new Supersession(deps.fs, root3).supersede(
      requiredFlag(options, "old", "number"),
      requiredFlag(options, "new", "number"),
      options["dry-run"] === true
    );
    const verb = report3.dryRun ? "Would set" : "Set";
    deps.stdout(
      json ? `${JSON.stringify(report3)}
` : `${verb} ${report3.files[0]?.path} to status superseded, superseded-by ADR ${report3.new}
`
    );
    return 0;
  })
};
var adrCommands = {
  new: newAdr,
  supersede
};

// src/guardrail/inventory.ts
var INVENTORY_PATH = ".claude/guardrails.yaml";
var MODES = ["audit", "enforce"];
var KINDS = ["bash", "file", "bash-and-file"];
var GuardrailError = class extends Error {
};
var MissingInventoryError = class extends GuardrailError {
};
var FIELDS = ["rule", "kind", "mode", "owner", "deny"];
var PERMISSION = /^(Bash|Read|Edit|Write)\(.+\)$/;
var RULE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
var fail = (problem) => {
  throw new GuardrailError(
    `${INVENTORY_PATH}: ${problem}. Fix the inventory, then rerun.`
  );
};
function entry(raw, index) {
  const where = `guardrails[${index}]`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail(`${where} must be an object`);
  }
  const fields = raw;
  for (const key of Object.keys(fields)) {
    if (!FIELDS.includes(key)) {
      fail(`${where} has an unknown field "${key}"`);
    }
  }
  const { rule, kind, mode, owner } = fields;
  if (typeof rule !== "string" || !RULE.test(rule)) {
    fail(`${where}.rule must be a lowercase kebab-case name`);
  }
  if (!KINDS.includes(kind)) {
    fail(`${where}.kind must be one of ${KINDS.join(", ")}`);
  }
  if (!MODES.includes(mode)) {
    fail(`${where}.mode must be audit or enforce`);
  }
  if (typeof owner !== "string" || owner.trim() === "") {
    fail(`${where}.owner must name the module that implements the rule`);
  }
  if (fields["deny"] !== void 0) {
    checkDeny(where, fields["deny"], kind);
  }
  return fields;
}
function checkDeny(where, deny2, kind) {
  const patterns = Array.isArray(deny2) ? deny2 : [];
  if (patterns.length === 0 || !patterns.every((p) => typeof p === "string" && PERMISSION.test(p))) {
    fail(
      `${where}.deny must be a non-empty list of permission rules such as "Bash(helm uninstall:*)"`
    );
  }
  for (const pattern of patterns) {
    const bash = pattern.startsWith("Bash(");
    const body = pattern.slice(pattern.indexOf("(") + 1, -1);
    if (bash && body.endsWith(":*") && body.slice(0, -2).includes("*")) {
      fail(
        `${where}.deny holds ${pattern}, which mixes a mid-pattern * with a trailing :*. Claude Code reads that as a literal prefix, so the rule matches less than it appears to. Instead, drop the :* and end the pattern with *`
      );
    }
    if (bash ? kind === "file" : kind === "bash") {
      fail(
        `${where}.deny holds ${pattern}, which does not fit its kind "${kind}"`
      );
    }
  }
}
function parseInventory(text9) {
  let value;
  try {
    value = JSON.parse(text9);
  } catch {
    return fail("is not JSON-compatible YAML");
  }
  const list3 = typeof value === "object" && value !== null ? value["guardrails"] : void 0;
  if (!Array.isArray(list3)) {
    return fail('must be an object with a "guardrails" list');
  }
  const guardrails = list3.map(entry);
  const seen = /* @__PURE__ */ new Set();
  for (const { rule } of guardrails) {
    if (seen.has(rule)) {
      fail(`${rule} must have exactly one entry, its owner's`);
    }
    seen.add(rule);
  }
  return { guardrails };
}
function modeOf(inventory, rule) {
  return inventory.guardrails.find((g) => g.rule === rule)?.mode ?? "enforce";
}
function auditRuleNames(inventory) {
  return inventory.guardrails.filter((g) => g.mode === "audit").map((g) => g.rule).sort();
}

// src/guardrail/deny.ts
function denyRules(inventory) {
  return inventory.guardrails.flatMap(
    (g) => g.deny === void 0 ? [] : [{ rule: g.rule, mode: g.mode, patterns: g.deny }]
  );
}
function denyList(inventory) {
  return denyRules(inventory).filter((r) => r.mode === "enforce").flatMap((r) => [...r.patterns]);
}
function items(pattern, path) {
  const found = [];
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern.charAt(i);
    if (char !== "*") {
      found.push({ literal: char });
    } else if (path && pattern.charAt(i + 1) === "*") {
      found.push({ crossesSlash: true });
      i++;
    } else {
      found.push({ crossesSlash: !path });
    }
  }
  return found;
}
function matches(pattern, text9) {
  let row = Array.from({ length: text9.length + 1 }, (_, j) => j === 0);
  for (const item of pattern) {
    const next = Array.from({ length: text9.length + 1 }, () => false);
    for (let j = 0; j <= text9.length; j++) {
      next[j] = "literal" in item ? j > 0 && row[j - 1] === true && text9[j - 1] === item.literal : row[j] === true || j > 0 && next[j - 1] === true && (item.crossesSlash || text9[j - 1] !== "/");
    }
    row = next;
  }
  return row[text9.length] === true;
}
function bashMatches(body, command) {
  if (!body.endsWith(":*")) {
    return matches(items(body, false), command);
  }
  const prefix = body.slice(0, -2);
  return matches(items(prefix, false), command) || matches(items(`${prefix} *`, false), command);
}
function denyMatches(pattern, tool, subject) {
  const open2 = pattern.indexOf("(");
  if (open2 < 0 || pattern.slice(0, open2) !== tool || !pattern.endsWith(")")) {
    return false;
  }
  const body = pattern.slice(open2 + 1, -1);
  return tool === "Bash" ? bashMatches(body, subject) : matches(items(body.replace(/^\.\//, ""), true), subject);
}
function parseSettings(text9) {
  try {
    return JSON.parse(text9);
  } catch {
    throw new GuardrailError(
      ".claude/settings.json is not JSON. Restore it from git, then rerun."
    );
  }
}
function settingsDeny(settingsText) {
  const permissions2 = parseSettings(settingsText).permissions;
  return Array.isArray(permissions2?.deny) ? permissions2.deny : [];
}
function denyDrift(inventory, settingsText) {
  const actual = settingsDeny(settingsText);
  const expected = denyList(inventory);
  const problems = [
    ...expected.filter((p) => !actual.includes(p)).map((p) => `${p} is missing from the settings deny list`),
    ...actual.filter((p) => !expected.includes(p)).map(
      (p) => `${p} is in the settings deny list but not generated from an enforced inventory rule`
    )
  ];
  if (problems.length === 0 && actual.join("\n") !== expected.join("\n")) {
    problems.push("the settings deny list is in a different order");
  }
  return problems;
}
function settingsWithDeny(settingsText, deny2) {
  const settings = parseSettings(settingsText);
  settings.permissions = { ...settings.permissions, deny: deny2 };
  return `${JSON.stringify(settings, null, 2)}
`;
}

// src/guardrail/read.ts
import { dirname as dirname4 } from "node:path";
async function readInventory(readFile2, root3) {
  let text9;
  try {
    text9 = await readFile2(`${root3}/${INVENTORY_PATH}`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    throw new MissingInventoryError(
      `${INVENTORY_PATH} is missing, so no guard rule has a declared mode. Restore it from git, then rerun.`
    );
  }
  return parseInventory(text9);
}
async function findInventory(readFile2, start) {
  let dir = start;
  for (; ; ) {
    try {
      return await readInventory(readFile2, dir);
    } catch (error) {
      const parent = dirname4(dir);
      if (!(error instanceof MissingInventoryError)) {
        throw error;
      }
      if (parent === dir) {
        return await readInventory(readFile2, start);
      }
      dir = parent;
    }
  }
}

// src/guardrail/commands.ts
var SETTINGS_PATH = ".claude/settings.json";
var status = {
  summary: "list each guardrail with its kind, mode and owner",
  async run({ json, deps }) {
    try {
      const { guardrails } = await readInventory(
        (path) => deps.fs.readFile(path),
        await deps.root()
      );
      if (json) {
        deps.stdout(`${JSON.stringify({ guardrails })}
`);
      } else {
        for (const g of guardrails) {
          deps.stdout(`${g.rule}	${g.kind}	${g.mode}	${g.owner}
`);
        }
      }
      return 0;
    } catch (error) {
      if (!(error instanceof GuardrailError)) {
        throw error;
      }
      deps.stderr(
        `${json ? `${JSON.stringify({ error: error.message })}
` : ""}${error.message}
`
      );
      return 1;
    }
  }
};
async function writeDeny(deps, path, list3, allowRemoval) {
  const current = await deps.fs.readFile(path);
  const leaving = settingsDeny(current).filter((p) => !list3.includes(p));
  if (leaving.length > 0) {
    deps.stderr(
      `${SETTINGS_PATH}: these patterns would leave the deny list: ${leaving.join(", ")}.
`
    );
    if (!allowRemoval) {
      throw new GuardrailError(
        "Removing a deny rule weakens the guard. Instead, restore the rule in the inventory, or rerun with --allow-removal once the user has approved it."
      );
    }
  }
  await deps.fs.writeFile(path, settingsWithDeny(current, list3));
}
var deny = {
  summary: "print the settings deny list generated from the enforced deny rules; --check fails when settings differ, --write regenerates them",
  options: {
    check: "boolean",
    write: "boolean",
    "allow-removal": "boolean"
  },
  async run({ json, options, deps }) {
    const report3 = (problems, message) => {
      deps.stdout(json ? `${JSON.stringify({ problems })}
` : "");
      deps.stderr(`${message}
`);
      return 1;
    };
    try {
      if (options["check"] === true && options["write"] === true) {
        throw new GuardrailError(
          "--check and --write cannot be used together. Instead, run one, then the other."
        );
      }
      const root3 = await deps.root();
      const inventory = await readInventory((p) => deps.fs.readFile(p), root3);
      const list3 = denyList(inventory);
      const path = `${root3}/${SETTINGS_PATH}`;
      if (options["write"] === true) {
        await writeDeny(deps, path, list3, options["allow-removal"] === true);
      } else if (options["check"] === true) {
        const problems = denyDrift(inventory, await deps.fs.readFile(path));
        return problems.length === 0 ? 0 : report3(
          problems,
          `${SETTINGS_PATH}: ${problems.join("; ")}. The inventory owns the deny list. Instead of editing settings, change ${INVENTORY_PATH}, then run \`guardrail deny --write\`.`
        );
      }
      deps.stdout(
        json ? `${JSON.stringify({ deny: list3 })}
` : list3.map((p) => `${p}
`).join("")
      );
      return 0;
    } catch (error) {
      if (error instanceof GuardrailError) {
        return report3([error.message], error.message);
      }
      if (error.code === "ENOENT") {
        const message = `${SETTINGS_PATH} is missing. Restore it from git, then rerun.`;
        return report3([message], message);
      }
      throw error;
    }
  }
};
var guardrailCommands = { status, deny };

// src/flow/stages.ts
var STAGES = [
  "refine",
  "challenge",
  "await approval",
  "orchestrate",
  "write",
  "judge",
  "merge",
  "verify",
  "outcome"
];
var ROLE_STAGES = {
  refiner: { stage: "refine" },
  challenger: { stage: "challenge" },
  orchestrator: { stage: "orchestrate" },
  writer: { stage: "write" },
  judge: { stage: "judge" },
  // A verifier checks the merged change; earlier events are not verification.
  verifier: { stage: "verify", after: "pr.merged" }
};
var MAIN_SESSION_STAGE = "orchestrate";
var APPROVAL_LABEL = "ready-for-agent";
var GITHUB_STAGES = {
  "issue.opened": "await approval",
  "issue.closed": "outcome",
  outcome: "outcome",
  "pr.opened": "merge",
  "pr.merged": "merge",
  "challenge.round": "challenge"
};
var MIN_COMPLETED_IDEAS = 3;

// src/flow/intervals.ts
function uncovered(span, holes) {
  const sorted = holes.map(([a, b]) => [Math.max(a, span[0]), Math.min(b, span[1])]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let free = span[1] - span[0];
  let reached = span[0];
  for (const [a, b] of sorted) {
    const from = Math.max(a, reached);
    if (b > from) {
      free -= b - from;
      reached = b;
    }
  }
  return free;
}

// src/flow/github-waits.ts
var time = (event) => Date.parse(event.occurredAt);
function firstTime(events, match) {
  return events.filter(match).map(time).sort((a, b) => a - b)[0];
}
function githubSpans(events, asOf) {
  const closed = firstTime(events, (e) => e.kind === "issue.closed");
  const waits = [
    [
      "await approval",
      firstTime(events, (e) => e.kind === "issue.opened"),
      firstTime(
        events,
        (e) => e.kind === "issue.labelled" && e.label === APPROVAL_LABEL
      )
    ],
    [
      "merge",
      firstTime(events, (e) => e.kind === "pr.opened"),
      firstTime(events, (e) => e.kind === "pr.merged")
    ]
  ];
  const spans = [];
  for (const [stage, start, end] of waits) {
    if (start !== void 0) {
      const stop2 = end ?? closed ?? asOf;
      if (stop2 > start) {
        spans.push([stage, start, stop2]);
      }
    }
  }
  return spans;
}
function githubWaits(tally, waits, holes) {
  const [lo, hi] = tally.window;
  for (const [stage, start, stop2] of waits) {
    tally.present(stage, start, stop2);
    const from = Math.max(start, lo);
    const to = Math.min(stop2, hi);
    if (to > from) {
      tally.addMs(stage, "waitingMs", uncovered([from, to], holes));
    }
  }
}

// src/flow/attribution.ts
function attribute(events) {
  const byActor = /* @__PURE__ */ new Map();
  const actors = (e) => [e.pane && `pane:${e.pane}`, e.session && `session:${e.session}`].filter(
    (a) => typeof a === "string"
  );
  for (const event of events) {
    if (event.idea !== void 0) {
      for (const actor of actors(event)) {
        byActor.set(actor, event.idea);
      }
    }
  }
  const result = /* @__PURE__ */ new Map();
  for (const event of events) {
    const own2 = event.kind.startsWith("issue.") ? `#${event.number}` : void 0;
    const inherited = actors(event).map((a) => byActor.get(a)).find((i) => i !== void 0);
    result.set(event.id, event.idea ?? own2 ?? inherited);
  }
  return result;
}

// src/flow/scope.ts
var byNumber = (a, b) => a.localeCompare(b, void 0, { numeric: true });
function scopeOf({ since, until, ideas: ideas2 }) {
  return {
    since: since?.toISOString() ?? null,
    until: until?.toISOString() ?? null,
    ideas: ideas2 === void 0 ? null : [...new Set(ideas2)].sort(byNumber)
  };
}
var windowOf = ({ since, until }) => [
  since?.getTime() ?? -Infinity,
  until?.getTime() ?? Infinity
];
var clipMs = (window, from, to) => Math.max(0, Math.min(to, window[1]) - Math.max(from, window[0]));
var inWindow = (window, at) => at >= window[0] && at < window[1];

// src/flow/select.ts
function groupByIdea(events, window) {
  const ideaOf = attribute(events);
  const byIdea = /* @__PURE__ */ new Map();
  let unattributed = 0;
  for (const event of events) {
    const idea = ideaOf.get(event.id);
    if (idea === void 0) {
      unattributed += inWindow(window, time(event)) ? 1 : 0;
    } else {
      byIdea.set(idea, [...byIdea.get(idea) ?? [], event]);
    }
  }
  return { byIdea, unattributed };
}
function reach(own2, waits) {
  return Math.max(...own2.map(time), ...waits.map(([, , stop2]) => stop2));
}
function select(byIdea, { ideas: ideas2 }, window, asOf) {
  const kept = /* @__PURE__ */ new Map();
  for (const [idea, own2] of byIdea) {
    const waits = githubSpans(own2, asOf);
    const first = Math.min(...own2.map(time));
    if ((ideas2 === null || ideas2.includes(idea)) && first < window[1] && reach(own2, waits) >= window[0]) {
      kept.set(idea, { own: own2, waits });
    }
  }
  return kept;
}

// src/flow/toil.ts
var newLife = (first, window) => ({
  began: first.kind === "pane.spawned" || first.kind === "session.start",
  lastToolAt: void 0,
  failed: void 0,
  waits: [],
  window
});
function chargeToil(add, event, at, start, life) {
  const { window } = life;
  const gap = (from, to) => {
    const [a, b] = [Math.max(from, window[0]), Math.min(to, window[1])];
    return b > a ? uncovered([a, b], life.waits) : 0;
  };
  const isTool = event.kind === "tool.start" || event.kind === "tool.end";
  if (isTool && life.lastToolAt === void 0 && life.began) {
    add("starting", gap(start, at));
  }
  if (event.kind === "tool.start") {
    if (life.failed !== void 0 && life.failed.tool === event.tool) {
      add("retrying", gap(life.failed.at, at));
    }
    life.failed = void 0;
    life.lastToolAt = at;
  } else if (event.kind === "tool.end") {
    life.lastToolAt = at;
    life.failed = event.outcome === "failure" ? { tool: event.tool, at } : void 0;
  } else if ((event.kind === "pane.closed" || event.kind === "session.stop") && life.lastToolAt !== void 0) {
    add("stopping", gap(life.lastToolAt, at));
  }
}

// src/flow/wip.ts
var roundAverage = (value) => Math.round(value * 1e4) / 1e4;
function wipOf(spans, range) {
  const edges = spans.filter(([from, to]) => to > from).flatMap(([from, to]) => [
    [from, 1],
    [to, -1]
  ]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open2 = 0;
  let peak = 0;
  let ideaMs = 0;
  let last = range[0];
  for (const [time2, step] of edges) {
    ideaMs += open2 * (time2 - last);
    last = time2;
    open2 += step;
    peak = Math.max(peak, open2);
  }
  const length = range[1] - range[0];
  return { peak, average: length > 0 ? roundAverage(ideaMs / length) : 0 };
}
var widen = (into, span) => into === void 0 ? [span[0], span[1]] : [Math.min(into[0], span[0]), Math.max(into[1], span[1])];
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return null;
  }
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// src/flow/tally.ts
var emptyMillis = () => ({
  activeMs: 0,
  waitingMs: 0,
  events: 0,
  toilMs: { starting: 0, stopping: 0, waiting: 0, retrying: 0 }
});
var Tally = class {
  /** Only time inside this range is charged; infinite where an end is open. */
  constructor(window = [-Infinity, Infinity]) {
    this.window = window;
  }
  window;
  totals = new Map(
    STAGES.map((stage) => [stage, emptyMillis()])
  );
  /** One open interval per idea per stage, from `present` calls between `beginIdea` and `endIdea`. */
  open = new Map(
    STAGES.map((stage) => [stage, []])
  );
  current = /* @__PURE__ */ new Map();
  beginIdea() {
    this.current = /* @__PURE__ */ new Map();
  }
  /** The idea was in `stage` from `from` to `to`; its open interval grows to hold it. */
  present(stage, from, to) {
    const clipped = [
      Math.max(from, this.window[0]),
      Math.min(to, this.window[1])
    ];
    const kept = from === to ? from >= this.window[0] && from < this.window[1] : clipped[1] > clipped[0];
    if (kept) {
      this.current.set(stage, widen(this.current.get(stage), clipped));
    }
  }
  endIdea() {
    for (const [stage, span] of this.current) {
      this.open.get(stage).push(span);
    }
  }
  /**
   * The report's range: the window where it has both ends, else the shortest
   * span holding every idea's open interval in every stage.
   */
  range() {
    const all = [...this.open.values()].flat();
    const [lo, hi] = this.window;
    const held = all.length === 0 ? [0, 0] : [
      Math.min(...all.map(([from]) => from)),
      Math.max(...all.map(([, to]) => to))
    ];
    return [
      Number.isFinite(lo) ? lo : held[0],
      Number.isFinite(hi) ? hi : held[1]
    ];
  }
  /** Charges milliseconds the caller already clipped to the window. */
  addMs(stage, field3, ms) {
    this.totals.get(stage)[field3] += ms;
  }
  /** Charges the part of `[from, to]` inside the window. */
  add(stage, field3, from, to) {
    this.totals.get(stage)[field3] += clipMs(
      this.window,
      from,
      to
    );
  }
  /** Charges the part of `[from, to]` inside the window as toil. */
  addToil(stage, kind, from, to) {
    this.totals.get(stage).toilMs[kind] += clipMs(
      this.window,
      from,
      to
    );
  }
  /** Charges toil already clipped by the caller. */
  addToilMs(stage, kind, ms) {
    this.totals.get(stage).toilMs[kind] += ms;
  }
  count(stage) {
    this.totals.get(stage).events += 1;
  }
  /** Stages in loop order, with milliseconds converted to seconds. */
  stages() {
    const range = this.range();
    return STAGES.map((stage) => {
      const { activeMs, waitingMs, events, toilMs } = this.totals.get(
        stage
      );
      return {
        stage,
        activeSeconds: activeMs / 1e3,
        waitingSeconds: waitingMs / 1e3,
        events,
        toil: {
          startingSeconds: toilMs.starting / 1e3,
          stoppingSeconds: toilMs.stopping / 1e3,
          waitingSeconds: toilMs.waiting / 1e3,
          retryingSeconds: toilMs.retrying / 1e3
        },
        wip: wipOf(this.open.get(stage), range)
      };
    });
  }
};

// src/flow/cost.ts
var DEFAULT_TRAILING_IDEAS = 5;
var DEFAULT_MAX_INCREASE = 0.25;
var DEFAULT_COST = {
  trailingIdeas: DEFAULT_TRAILING_IDEAS,
  tokensPerIdea: { maxIncrease: DEFAULT_MAX_INCREASE },
  sessionsPerIdea: { maxIncrease: DEFAULT_MAX_INCREASE }
};
function costOf(own2) {
  const latest = /* @__PURE__ */ new Map();
  let sessions = 0;
  for (const event of own2) {
    if (event.kind === "session.launch") {
      sessions += 1;
    } else if (event.kind === "token.usage" && event.tokens !== void 0) {
      const key = event.session ?? event.pane ?? event.id;
      const seen = latest.get(key);
      if (seen === void 0 || time(event) >= seen.at) {
        latest.set(key, { at: time(event), tokens: event.tokens });
      }
    }
  }
  const measured = latest.size > 0;
  const tokens = [...latest.values()].reduce((sum, v) => sum + v.tokens, 0);
  return { tokens, measured, sessions };
}
function metric(values, trailing, { maxIncrease }) {
  if (values.length < trailing + 1) {
    return {
      status: "insufficient history",
      closedIdeas: values.length,
      needed: trailing + 1
    };
  }
  const current = values[values.length - 1];
  const before2 = values.slice(-(trailing + 1), -1);
  const trailingAverage = before2.reduce((sum, v) => sum + v.value, 0) / before2.length;
  return {
    status: "ok",
    currentIdea: current.idea,
    current: current.value,
    trailingAverage,
    maxIncrease,
    worsened: current.value > trailingAverage * (1 + maxIncrease)
  };
}
function costMetrics(byIdea, window, options) {
  const closed = [];
  for (const [idea, own2] of byIdea) {
    const at = own2.filter((e) => e.kind === "issue.closed").map(time).sort((a, b) => a - b)[0];
    if (at !== void 0 && inWindow(window, at)) {
      closed.push({ idea, at, ...costOf(own2) });
    }
  }
  closed.sort(
    (a, b) => a.at - b.at || a.idea.localeCompare(b.idea, void 0, { numeric: true })
  );
  const { trailingIdeas } = options;
  return {
    trailingIdeas,
    tokensPerIdea: metric(
      // An idea with no token.usage was not measured; it is not a zero.
      closed.filter((c) => c.measured).map((c) => ({ idea: c.idea, value: c.tokens })),
      trailingIdeas,
      options.tokensPerIdea
    ),
    sessionsPerIdea: metric(
      closed.map((c) => ({ idea: c.idea, value: c.sessions })),
      trailingIdeas,
      options.sessionsPerIdea
    )
  };
}

// src/flow/idea-metrics.ts
var firstClosed = (own2) => firstTime(own2, (e) => e.kind === "issue.closed");
function leadTime(byIdea, window) {
  const ideas2 = [];
  for (const [idea, own2] of byIdea) {
    const outcome = firstClosed(own2);
    if (outcome !== void 0 && inWindow(window, outcome)) {
      const first = Math.min(...own2.map(time));
      ideas2.push({ idea, seconds: (outcome - first) / 1e3 });
    }
  }
  ideas2.sort(
    (a, b) => a.idea.localeCompare(b.idea, void 0, { numeric: true })
  );
  const seconds3 = ideas2.map((i) => i.seconds);
  return {
    ideas: ideas2,
    medianSeconds: median(seconds3),
    maxSeconds: seconds3.length === 0 ? null : Math.max(...seconds3)
  };
}
function ideaMetrics(byIdea, window, cost = {}) {
  return {
    leadTime: leadTime(byIdea, window),
    metrics: costMetrics(byIdea, window, { ...DEFAULT_COST, ...cost })
  };
}

// src/flow/report.ts
var REPORT_VERSION = 5;
var COST_KINDS = /* @__PURE__ */ new Set(["token.usage", "session.launch"]);
var STATE_AFTER = {
  "session.start": "active",
  "tool.start": "active",
  "tool.end": "active",
  "pane.spawned": "active",
  "pane.busy": "active",
  "pane.waiting": "waiting",
  "pane.closed": "closed",
  "session.stop": "closed"
};
function roleOf(event) {
  for (const name of [event.agent, event.pane, event.session]) {
    const role = name?.split("-").at(-1);
    if (role !== void 0 && Object.hasOwn(ROLE_STAGES, role)) {
      return ROLE_STAGES[role];
    }
  }
  return void 0;
}
function chargeActor(tally, items2) {
  const spans = [];
  let closed = false;
  let start = time(items2[0].event);
  let life = newLife(items2[0].event, tally.window);
  items2.forEach(({ event, stage }, i) => {
    const at = time(event);
    if (closed && (event.kind === "pane.spawned" || event.kind === "session.start")) {
      closed = false;
      start = at;
      life = newLife(event, tally.window);
    }
    const state = STATE_AFTER[event.kind];
    if (closed) {
      return;
    }
    chargeToil(
      (kind, ms) => tally.addToilMs(stage, kind, ms),
      event,
      at,
      start,
      life
    );
    if (state === "closed") {
      closed = true;
      spans.push([start, at]);
    } else if (state !== void 0 && i < items2.length - 1) {
      const next = time(items2[i + 1].event);
      tally.add(stage, state === "active" ? "activeMs" : "waitingMs", at, next);
      tally.present(stage, at, next);
      if (state === "waiting") {
        life.waits.push([at, next]);
        tally.addToil(stage, "waiting", at, next);
      }
    }
  });
  if (!closed) {
    spans.push([start, time(items2.at(-1).event)]);
  }
  return spans;
}
function actorTime(tally, events) {
  const byActor = /* @__PURE__ */ new Map();
  for (const item of events) {
    const key = item.event.pane ?? item.event.session;
    if (key !== void 0) {
      byActor.set(key, [...byActor.get(key) ?? [], item]);
    }
  }
  const lifetimes = [];
  for (const items2 of byActor.values()) {
    items2.sort((x, y) => time(x.event) - time(y.event));
    const spans = chargeActor(tally, items2);
    if (items2[0].stage !== "orchestrate") {
      lifetimes.push(...spans);
    }
  }
  return lifetimes;
}
function stageOf(event, mergedAt) {
  const github = GITHUB_STAGES[event.kind];
  if (github !== void 0) {
    return github;
  }
  if (event.kind === "issue.labelled") {
    return event.label === APPROVAL_LABEL ? "await approval" : void 0;
  }
  const role = roleOf(event);
  if (role !== void 0) {
    const gate = role.after === "pr.merged" ? mergedAt : void 0;
    const open2 = role.after === void 0 || gate !== void 0 && time(event) >= gate;
    return open2 ? role.stage : void 0;
  }
  return event.pane === void 0 && event.source === "claude" ? MAIN_SESSION_STAGE : void 0;
}
function roundShare(share) {
  return Math.round(share * 1e4) / 1e4;
}
function chargeIdea(tally, own2, waits) {
  tally.beginIdea();
  const mergedAt = firstTime(own2, (e) => e.kind === "pr.merged");
  const mapped = [];
  let unmapped = 0;
  for (const event of own2) {
    if (COST_KINDS.has(event.kind)) {
      continue;
    }
    const stage = stageOf(event, mergedAt);
    const inRange = inWindow(tally.window, time(event));
    if (stage !== void 0) {
      if (inRange) {
        tally.count(stage);
        tally.present(stage, time(event), time(event));
      }
      mapped.push({ event, stage });
    } else if (inRange) {
      unmapped += 1;
    }
  }
  githubWaits(tally, waits, actorTime(tally, mapped));
  tally.endIdea();
  return unmapped;
}
function nameBottleneck(tally, completed, minCompletedIdeas) {
  const stages = [...tally.totals.entries()];
  const totalMs = stages.reduce((sum, [, s]) => sum + s.waitingMs, 0);
  const [stage, worst] = stages.reduce(
    (a, b) => b[1].waitingMs > a[1].waitingMs ? b : a
  );
  if (completed < minCompletedIdeas) {
    return {
      bottleneck: null,
      bottleneckNote: `Not enough data: ${completed} of ${minCompletedIdeas} completed ideas needed to name a bottleneck.`
    };
  }
  if (totalMs === 0) {
    return {
      bottleneck: null,
      bottleneckNote: "No waiting time recorded, so there is no bottleneck."
    };
  }
  return {
    bottleneck: {
      stage,
      waitingSeconds: worst.waitingMs / 1e3,
      share: roundShare(worst.waitingMs / totalMs)
    },
    bottleneckNote: null
  };
}
function buildReport(events, options) {
  const { asOf, minCompletedIdeas } = options;
  const scope = scopeOf(options);
  const window = windowOf(options);
  const { byIdea, unattributed } = groupByIdea(events, window);
  const covered = select(byIdea, scope, window, asOf.getTime());
  const tally = new Tally(window);
  const ownByIdea = /* @__PURE__ */ new Map();
  let unmapped = 0;
  let completed = 0;
  for (const [idea, { own: own2, waits }] of covered) {
    ownByIdea.set(idea, own2);
    unmapped += chargeIdea(tally, own2, waits);
    const outcome = firstClosed(own2);
    completed += outcome !== void 0 && inWindow(window, outcome) ? 1 : 0;
  }
  if (scope.ideas === null) {
    unmapped += unattributed;
  }
  return {
    version: REPORT_VERSION,
    asOf: asOf.toISOString(),
    scope,
    ideas: { total: covered.size, completed },
    minCompletedIdeas,
    stages: tally.stages(),
    ...ideaMetrics(ownByIdea, window, options.cost),
    ...nameBottleneck(tally, completed, minCompletedIdeas),
    unmappedEvents: unmapped
  };
}

// src/flow/cost-config.ts
var HARNESS_CONFIG = ".claude/harness.json";
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function bad(file, key, fix2) {
  return { error: `Invalid ${file}: key "${key}" ${fix2}` };
}
function unknownKey(file, path, raw, known) {
  const extra = Object.keys(raw).find((k) => !known.includes(k));
  return extra === void 0 ? void 0 : bad(
    file,
    path === "" ? extra : `${path}.${extra}`,
    `is not a harness config key. Remove it, or use one of: ${known.join(", ")}.`
  );
}
function threshold(file, path, value, fallback) {
  if (value === void 0) {
    return fallback;
  }
  if (!isObject(value)) {
    return bad(file, path, 'must be an object. Use {"maxIncrease": 0.25}.');
  }
  const extra = unknownKey(file, path, value, ["maxIncrease"]);
  if (extra !== void 0) {
    return extra;
  }
  const max = value["maxIncrease"];
  if (max === void 0) {
    return fallback;
  }
  if (typeof max !== "number" || !Number.isFinite(max) || max < 0) {
    return bad(
      file,
      `${path}.maxIncrease`,
      `must be a number of at least 0 (0.25 means worsened above 125% of the trailing average). Fix the value.`
    );
  }
  return { maxIncrease: max };
}
function parseCost(file, cost) {
  const trailing = cost["trailingIdeas"] ?? DEFAULT_COST.trailingIdeas;
  if (typeof trailing !== "number" || !Number.isSafeInteger(trailing) || trailing < 1) {
    return bad(
      file,
      "cost.trailingIdeas",
      "must be a whole number of at least 1. Fix the value."
    );
  }
  const tokens = threshold(
    file,
    "cost.tokensPerIdea",
    cost["tokensPerIdea"],
    DEFAULT_COST.tokensPerIdea
  );
  if ("error" in tokens) {
    return tokens;
  }
  const sessions = threshold(
    file,
    "cost.sessionsPerIdea",
    cost["sessionsPerIdea"],
    DEFAULT_COST.sessionsPerIdea
  );
  if ("error" in sessions) {
    return sessions;
  }
  return {
    cost: {
      trailingIdeas: trailing,
      tokensPerIdea: tokens,
      sessionsPerIdea: sessions
    }
  };
}
function parseHarnessConfig(text9, file) {
  let value;
  try {
    value = JSON.parse(text9);
  } catch {
    return { error: `Invalid ${file}: it is not valid JSON. Fix the syntax.` };
  }
  if (!isObject(value)) {
    return bad(file, "(root)", "must be a JSON object. Use {}.");
  }
  const top = unknownKey(file, "", value, ["cost"]);
  if (top !== void 0) {
    return top;
  }
  const cost = value["cost"];
  if (cost === void 0) {
    return { cost: DEFAULT_COST };
  }
  if (!isObject(cost)) {
    return bad(file, "cost", "must be an object. Use {}.");
  }
  const inner = unknownKey(file, "cost", cost, [
    "trailingIdeas",
    "tokensPerIdea",
    "sessionsPerIdea"
  ]);
  if (inner !== void 0) {
    return inner;
  }
  return parseCost(file, cost);
}

// src/cli/flow-commands.ts
import { join as join2 } from "node:path";

// src/ledger/poll-lock.ts
var STALE_LOCK_MS = 6e4;
var isExists = (error) => error.code === "EEXIST";
async function isStale(fs, clock, path) {
  const taken = Date.parse(await fs.readFile(path).catch(() => ""));
  return Number.isNaN(taken) || clock.now().getTime() - taken > STALE_LOCK_MS;
}
async function acquire(fs, clock, path) {
  const busy = {
    ok: false,
    message: `Another poll holds ${path}. Wait for it, or delete the file if no poll is running.`
  };
  for (const attempt of [0, 1]) {
    try {
      await fs.createFile(path, clock.now().toISOString());
      return {
        ok: true,
        refresh: () => fs.writeFile(path, clock.now().toISOString()),
        release: () => fs.remove(path)
      };
    } catch (error) {
      if (!isExists(error)) {
        throw error;
      }
    }
    if (attempt === 1 || !await isStale(fs, clock, path)) {
      return busy;
    }
    await fs.remove(path);
  }
  return busy;
}

// src/ledger/schema.ts
var SOURCES = ["claude", "herdr", "github"];
var KINDS2 = [
  "session.start",
  "session.stop",
  "tool.start",
  "tool.end",
  "pane.spawned",
  "pane.busy",
  "pane.waiting",
  "pane.closed",
  "issue.opened",
  "issue.labelled",
  "issue.closed",
  "pr.opened",
  "pr.merged",
  "outcome",
  "flag.activated",
  "token.usage",
  "session.launch",
  "guard.audit",
  "challenge.round"
];
var OUTCOMES = ["success", "failure"];
var TOOL_KINDS = ["tool.start", "tool.end"];
var NUMBER_KINDS = [
  "issue.opened",
  "issue.labelled",
  "issue.closed",
  "pr.opened",
  "pr.merged",
  "outcome",
  "challenge.round"
];
var LAUNCH_KINDS = ["session.launch"];
var TOKEN_KINDS = ["token.usage"];
var SCHEMA_VERSION = 1;
var NAME = /^[\w.:/#@-]{1,128}$/;
var TOOL = /^[\w.:-]{1,100}$/;
var LABEL = /^[^\p{Cc}]{1,100}$/u;
var TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
var NAME_HINT = "must be 1-128 letters, digits or . _ : / # @ -";
var TIME_HINT = "must be an ISO 8601 UTC time such as 2026-01-02T03:04:05.000Z";
var ALLOWED = /* @__PURE__ */ new Set([
  "schema",
  "id",
  "source",
  "kind",
  "occurredAt",
  "recordedAt",
  "session",
  "pane",
  "agent",
  "idea",
  "stage",
  "tool",
  "outcome",
  "label",
  "number",
  "tokens",
  "role",
  "tier"
]);
function isName(value) {
  return typeof value === "string" && NAME.test(value);
}
function isTimestamp(value) {
  if (!TIMESTAMP.test(value)) {
    return false;
  }
  const time2 = new Date(value);
  if (Number.isNaN(time2.getTime())) {
    return false;
  }
  return time2.toISOString().slice(0, 10) === value.slice(0, 10);
}
function bad2(field3, problem) {
  return {
    ok: false,
    field: field3,
    message: `Invalid event: field "${field3}" ${problem}.`
  };
}
var isText = (pattern) => (value) => typeof value === "string" && pattern.test(value);
var RULES = [
  { field: "id", check: isText(NAME), hint: NAME_HINT },
  { field: "session", check: isText(NAME), hint: NAME_HINT },
  { field: "pane", check: isText(NAME), hint: NAME_HINT },
  { field: "agent", check: isText(NAME), hint: NAME_HINT },
  { field: "idea", check: isText(NAME), hint: NAME_HINT },
  { field: "stage", check: isText(NAME), hint: NAME_HINT },
  {
    field: "tool",
    check: isText(TOOL),
    hint: "must be a tool name of letters, digits or . _ : -",
    kinds: TOOL_KINDS
  },
  {
    field: "outcome",
    check: (v) => OUTCOMES.includes(v),
    hint: `must be one of ${OUTCOMES.join(", ")}`,
    kinds: ["tool.end"]
  },
  {
    field: "label",
    check: isText(LABEL),
    hint: "must be 1-100 characters with no control characters",
    kinds: [
      "issue.labelled",
      "outcome",
      "flag.activated",
      "guard.audit",
      "challenge.round"
    ]
  },
  {
    field: "number",
    check: (v) => Number.isSafeInteger(v) && v >= 1,
    hint: "must be a positive integer",
    kinds: NUMBER_KINDS
  },
  {
    field: "tokens",
    check: (v) => Number.isSafeInteger(v) && v >= 1,
    hint: "must be a positive integer",
    kinds: TOKEN_KINDS
  },
  { field: "role", check: isText(NAME), hint: NAME_HINT, kinds: LAUNCH_KINDS },
  { field: "tier", check: isText(NAME), hint: NAME_HINT, kinds: LAUNCH_KINDS }
];
function checkShape(input, mode) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return bad2("event", "must be a JSON object");
  }
  const raw = input;
  for (const key of Object.keys(raw)) {
    if (!ALLOWED.has(key) && raw[key] !== void 0) {
      return bad2(key, "is not a ledger field and is never stored");
    }
  }
  if (mode === "input") {
    for (const field3 of ["recordedAt", "schema"]) {
      if (raw[field3] !== void 0) {
        return bad2(field3, "is set by the ledger, not the caller");
      }
    }
  }
  return void 0;
}
function checkCore(raw, mode) {
  if (mode === "stored" && raw["schema"] !== SCHEMA_VERSION) {
    return bad2("schema", `must be ${SCHEMA_VERSION}`);
  }
  if (!SOURCES.includes(raw["source"])) {
    return bad2("source", `must be one of ${SOURCES.join(", ")}`);
  }
  if (!KINDS2.includes(raw["kind"])) {
    return bad2("kind", `must be one of ${KINDS2.join(", ")}`);
  }
  const times = mode === "stored" ? ["occurredAt", "recordedAt"] : ["occurredAt"];
  for (const field3 of times) {
    const value = raw[field3];
    if (typeof value !== "string" || !isTimestamp(value)) {
      return bad2(field3, TIME_HINT);
    }
  }
  return void 0;
}
function checkRule(rule, raw, mode) {
  const value = raw[rule.field];
  const kind = raw["kind"];
  const applies = rule.kinds === void 0 || rule.kinds.includes(kind);
  if (value === void 0) {
    const needed = rule.kinds !== void 0 && applies || rule.field === "id" && mode === "stored";
    return needed ? bad2(rule.field, `is required on ${kind} events`) : void 0;
  }
  if (!applies) {
    return bad2(
      rule.field,
      `is only allowed on ${rule.kinds?.join(" and ")} events`
    );
  }
  return rule.check(value) ? void 0 : bad2(rule.field, rule.hint);
}
function parseEvent(input, mode) {
  const failure2 = checkShape(input, mode) ?? checkCore(input, mode) ?? RULES.map((rule) => checkRule(rule, input, mode)).find(Boolean);
  if (failure2 !== void 0) {
    return failure2;
  }
  const event = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== void 0)
  );
  return { ok: true, event };
}

// src/ledger/github-poll.ts
var LIMIT = 1e3;
var describe2 = (code, stdout, stderr2) => {
  const text9 = `${stderr2}${stdout}`.trim();
  return text9 === "" ? `exit code ${code}` : `exit code ${code}: ${text9}`;
};
var RATE_LIMITED = /rate limit|HTTP 403|HTTP 429/i;
async function resetTime(gh) {
  const found = await gh.runner.run("gh", ["api", "rate_limit"]);
  try {
    const parsed = JSON.parse(found.stdout);
    const core = asRecord(asRecord(asRecord(parsed)["resources"])["core"]);
    const reset = core["reset"];
    return typeof reset === "number" && Number.isFinite(reset) ? new Date(reset * 1e3).toISOString() : void 0;
  } catch {
    return void 0;
  }
}
async function rateLimited(gh, what) {
  const reset = await resetTime(gh);
  const retry = reset === void 0 ? "Retry in a few minutes" : `Retry after ${reset}`;
  return `gh ${what} hit the GitHub rate limit. ${retry}; poll again then (gh api rate_limit shows the reset time).`;
}
async function query(gh, what, args) {
  const found = await gh.runner.run("gh", args);
  await gh.refresh();
  if (found.code !== 0) {
    if (RATE_LIMITED.test(`${found.stderr}${found.stdout}`)) {
      return rateLimited(gh, what);
    }
    return `gh ${what} failed: ${describe2(found.code, found.stdout, found.stderr)}. Is gh installed and logged in (gh auth status)?`;
  }
  let value;
  try {
    value = JSON.parse(found.stdout);
  } catch {
    return `gh ${what} did not print JSON. Run it by hand and check the gh version.`;
  }
  const isObject2 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  return Array.isArray(value) && value.every(isObject2) ? value : `gh ${what} did not print a JSON list of objects; the gh version may have changed its output.`;
}
var asRecord = (value) => typeof value === "object" && value !== null ? value : {};
var when = (value) => typeof value === "string" && isTimestamp(value) ? value : void 0;
var count = (value) => Number.isSafeInteger(value) && value >= 1 ? value : void 0;
function closedIssue(raw) {
  const refs = raw["closingIssuesReferences"];
  const first = Array.isArray(refs) ? count(asRecord(refs[0])["number"]) : void 0;
  return first === void 0 ? void 0 : `#${first}`;
}
function fromItems(items2, openedKind, mergedKind, mergedField = "mergedAt") {
  const out = [];
  for (const item of items2) {
    const raw = asRecord(item);
    const number = count(raw["number"]);
    const opened = when(raw["createdAt"]);
    const merged = when(raw[mergedField]);
    if (number === void 0) {
      continue;
    }
    const idea = closedIssue(raw);
    const at = (kind, occurredAt, id) => out.push({
      id,
      source: "github",
      kind,
      occurredAt,
      number,
      ...idea === void 0 ? {} : { idea }
    });
    if (opened !== void 0) {
      at(openedKind, opened, `github:${openedKind}:${number}`);
    }
    if (mergedKind !== void 0 && merged !== void 0) {
      at(mergedKind, merged, `github:${mergedKind}:${number}`);
    }
  }
  return out;
}
function fromLabelEvents(items2) {
  const out = [];
  for (const item of items2) {
    const raw = asRecord(item);
    const id = count(raw["id"]);
    const number = count(asRecord(raw["issue"])["number"]);
    const occurredAt = when(raw["created_at"]);
    const label = asRecord(raw["label"])["name"];
    if (raw["event"] === "labeled" && id !== void 0 && number !== void 0 && occurredAt !== void 0 && typeof label === "string") {
      out.push({
        id: `github:issue.labelled:${id}`,
        source: "github",
        kind: "issue.labelled",
        occurredAt,
        number,
        label
      });
    }
  }
  return out;
}
async function pollGithub(deps) {
  const held = await acquire(deps.fs, deps.clock, `${deps.ledger.path}.lock`);
  if (!held.ok) {
    return { ok: false, message: held.message };
  }
  try {
    return await poll(deps, () => held.refresh());
  } finally {
    await held.release();
  }
}
var PAGE = 100;
var MAX_PAGES = 3;
var searchFrom = (field3, since) => since === void 0 ? [] : ["--search", `${field3}:>=${since.slice(0, 10)}`];
async function fetchEvents(gh, repo, since) {
  const events = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const got = await query(gh, "api issues/events", [
      "api",
      `repos/${repo}/issues/events?per_page=${PAGE}&page=${page}`
    ]);
    if (typeof got === "string") {
      return got;
    }
    events.push(...got);
    const oldest = when(got.at(-1)?.["created_at"]);
    const older = since !== void 0 && oldest !== void 0 && Date.parse(oldest) < Date.parse(since);
    if (got.length < PAGE || older) {
      break;
    }
  }
  return events;
}
async function fetchAll(gh, repo, since) {
  const flag = ["--repo", repo];
  const list3 = ["--state", "all", "--limit", String(LIMIT)];
  const issues = await query(gh, "issue list", [
    "issue",
    "list",
    ...flag,
    ...list3,
    // Updated, not created: an issue opened long ago and closed since must appear.
    ...searchFrom("updated", since),
    "--json",
    "number,createdAt,closedAt"
  ]);
  if (typeof issues === "string") {
    return issues;
  }
  const prs = await query(gh, "pr list", [
    "pr",
    "list",
    ...flag,
    ...list3,
    ...searchFrom("updated", since),
    "--json",
    "number,createdAt,mergedAt,closingIssuesReferences"
  ]);
  if (typeof prs === "string") {
    return prs;
  }
  const events = await fetchEvents(gh, repo, since);
  if (typeof events === "string") {
    return events;
  }
  if ([issues, prs].some((a) => a.length >= LIMIT)) {
    return `gh returned ${LIMIT} issues or PRs, the most one poll lists, so some may be missing. Pass a later --since, or raise LIMIT in github-poll.ts.`;
  }
  return { issues, prs, events };
}
async function poll(deps, refresh) {
  const { events: known } = await deps.ledger.list({ source: "github" });
  const have = new Set(known.map((e) => e.id));
  const since = deps.since ?? known.map((e) => e.occurredAt).reduce(
    (latest, t) => latest === void 0 || Date.parse(t) > Date.parse(latest) ? t : latest,
    void 0
  );
  const fetched = await fetchAll(
    { runner: deps.runner, refresh },
    deps.repo,
    since
  );
  if (typeof fetched === "string") {
    return { ok: false, message: fetched };
  }
  const { issues, prs, events } = fetched;
  const planned = [
    ...fromItems(issues, "issue.opened", "issue.closed", "closedAt"),
    ...fromItems(prs, "pr.opened", "pr.merged"),
    ...fromLabelEvents(events)
  ].filter((e) => !have.has(e.id ?? "")).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  for (const input of planned) {
    const result = await deps.ledger.record(input);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }
  }
  return { ok: true, recorded: planned.length, events: planned };
}

// src/ledger/herdr-poll.ts
var PANE_KINDS = [
  "pane.spawned",
  "pane.busy",
  "pane.waiting",
  "pane.closed"
];
var STATUS_KIND = {
  working: "pane.busy",
  idle: "pane.waiting",
  blocked: "pane.waiting",
  done: "pane.waiting"
};
function describe3(code, stdout, stderr2) {
  const text9 = `${stderr2}${stdout}`.trim();
  return text9 === "" ? `exit code ${code}` : `exit code ${code}: ${text9}`;
}
function toSeen(entry2) {
  if (typeof entry2 !== "object" || entry2 === null) {
    return void 0;
  }
  const raw = entry2;
  const pane = raw["pane_id"];
  const status2 = STATUS_KIND[String(raw["agent_status"])];
  const agent = [raw["name"], raw["agent"]].find(isName) ?? "unknown";
  if (!isName(pane) || status2 === void 0) {
    return void 0;
  }
  return { pane, agent, status: status2 };
}
async function listAgents(runner) {
  const found = await runner.run("herdr", ["agent", "list"]);
  if (found.code !== 0) {
    return {
      message: `herdr agent list failed: ${describe3(found.code, found.stdout, found.stderr)}. Is the herdr server running?`
    };
  }
  let value;
  try {
    value = JSON.parse(found.stdout);
  } catch {
    return {
      message: "herdr agent list did not print JSON. Run `herdr agent list` by hand and check the herdr version."
    };
  }
  const agents = value?.result?.agents;
  if (!Array.isArray(agents)) {
    return {
      message: "herdr agent list printed no agent list (.result.agents); the herdr version may have changed its output."
    };
  }
  const present = /* @__PURE__ */ new Set();
  for (const entry2 of agents) {
    const pane = entry2?.pane_id;
    if (typeof pane === "string") {
      present.add(pane);
    }
  }
  return { seen: agents.map(toSeen).filter((s) => s !== void 0), present };
}
async function lastRecorded(ledger) {
  const { events } = await ledger.list({ source: "herdr" });
  const last = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (event.pane !== void 0 && PANE_KINDS.includes(event.kind)) {
      last.set(event.pane, {
        kind: event.kind,
        ...event.agent === void 0 ? {} : { agent: event.agent }
      });
    }
  }
  return last;
}
async function pollHerdr(deps) {
  const held = await acquire(deps.fs, deps.clock, `${deps.ledger.path}.lock`);
  if (!held.ok) {
    return { ok: false, message: held.message };
  }
  try {
    return await poll2(deps);
  } finally {
    await held.release();
  }
}
function plan(listed, last, observedAt) {
  const planned = [];
  const event = (kind, pane, agent) => planned.push({
    source: "herdr",
    kind,
    occurredAt: observedAt,
    pane,
    agent
  });
  for (const { pane, agent, status: status2 } of listed.seen) {
    const recorded = last.get(pane);
    const open2 = recorded !== void 0 && recorded.kind !== "pane.closed";
    if (open2 && recorded.agent !== void 0 && recorded.agent !== agent) {
      event("pane.closed", pane, recorded.agent);
    }
    const sameAgent = open2 && (recorded.agent ?? agent) === agent;
    if (!sameAgent) {
      event("pane.spawned", pane, agent);
    }
    if (!sameAgent || recorded.kind !== status2) {
      event(status2, pane, agent);
    }
  }
  for (const [pane, state] of last) {
    if (state.kind !== "pane.closed" && !listed.present.has(pane)) {
      event("pane.closed", pane, state.agent ?? "unknown");
    }
  }
  return planned;
}
async function poll2(deps) {
  const observedAt = deps.clock.now().toISOString();
  const listed = await listAgents(deps.runner);
  if ("message" in listed) {
    return { ok: false, message: listed.message };
  }
  const planned = plan(listed, await lastRecorded(deps.ledger), observedAt);
  for (const input of planned) {
    const result = await deps.ledger.record(input);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }
  }
  return { ok: true, recorded: planned.length, events: planned };
}

// src/ledger/ledger.ts
var DEFAULT_LEDGER = ".kore/state/ledger.jsonl";
var Ledger = class {
  constructor(fs, clock, ids, path) {
    this.fs = fs;
    this.clock = clock;
    this.ids = ids;
    this.path = path;
  }
  fs;
  clock;
  ids;
  path;
  /** Validates one event, then appends it as one line with a single write. */
  async record(input) {
    const parsed = parseEvent(input, "input");
    if (!parsed.ok) {
      return parsed;
    }
    const given = parsed.event;
    const event = {
      ...given,
      schema: SCHEMA_VERSION,
      id: given.id ?? this.ids.next(),
      recordedAt: this.clock.now().toISOString()
    };
    await this.fs.appendFile(this.path, `${JSON.stringify(event)}
`);
    return { ok: true, event };
  }
  async list(filter) {
    const text9 = await this.read();
    const events = [];
    let skipped = 0;
    for (const line2 of text9.split("\n")) {
      if (line2 === "") {
        continue;
      }
      const event = parseLine(line2);
      if (event === void 0) {
        skipped += 1;
      } else if (matches2(event, filter)) {
        events.push(event);
      }
    }
    return { events, skipped };
  }
  async read() {
    try {
      return await this.fs.readFile(this.path);
    } catch (error) {
      if (error.code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }
};
function parseLine(line2) {
  let value;
  try {
    value = JSON.parse(line2);
  } catch {
    return void 0;
  }
  const parsed = parseEvent(value, "stored");
  return parsed.ok ? parsed.event : void 0;
}
function matches2(event, filter) {
  return (filter.session === void 0 || event.session === filter.session) && (filter.pane === void 0 || event.pane === filter.pane) && (filter.idea === void 0 || event.idea === filter.idea) && (filter.source === void 0 || event.source === filter.source) && (filter.kind === void 0 || event.kind === filter.kind) && (filter.since === void 0 || Date.parse(event.occurredAt) >= Date.parse(filter.since)) && (filter.until === void 0 || Date.parse(event.occurredAt) < Date.parse(filter.until));
}

// src/cli/ledger-commands.ts
import { resolve as resolve3 } from "node:path";
var EVENT_FLAGS = [
  "id",
  "source",
  "kind",
  "occurred-at",
  "session",
  "pane",
  "agent",
  "idea",
  "stage",
  "tool",
  "outcome",
  "label",
  "number",
  "tokens",
  "role",
  "tier"
];
var STRING_FLAGS = (names3) => Object.fromEntries(names3.map((n) => [n, "string"]));
var camel = (flag) => flag.replace(/-(\w)/g, (_, c) => c.toUpperCase());
var NO_ROOT = "Cannot find the main checkout root for the shared ledger. Run inside the repository, set KORE_ROOT to its root, or pass --ledger <path>.";
async function ledgerPath({
  deps,
  options
}) {
  const given = options["ledger"];
  if (typeof given === "string") {
    return resolve3(deps.cwd, given);
  }
  const main = await mainRoot(deps);
  return main === void 0 ? void 0 : resolve3(main, DEFAULT_LEDGER);
}
async function openLedger(context2) {
  const path = await ledgerPath(context2);
  if (path === void 0) {
    return { error: NO_ROOT };
  }
  const { deps } = context2;
  return { ledger: new Ledger(deps.fs, deps.clock, deps.ids, path) };
}
async function eventInput(context2) {
  const given = EVENT_FLAGS.filter((f) => context2.options[f] !== void 0);
  if (given.length > 0) {
    return {
      input: Object.fromEntries(
        given.map((f) => {
          const value = String(context2.options[f]);
          const isCount = (f === "number" || f === "tokens") && /^\d+$/.test(value);
          return [camel(f), isCount ? Number(value) : value];
        })
      )
    };
  }
  const text9 = await context2.deps.stdin();
  if (text9.trim() === "") {
    return {
      error: "No event given. Pass --source, --kind and --occurred-at, or one JSON event on stdin.",
      code: 2
    };
  }
  try {
    return { input: JSON.parse(text9) };
  } catch {
    return { error: "Invalid event: stdin is not valid JSON." };
  }
}
function reject({ json, deps }, message, field3, code = 1) {
  deps.stderr(
    json ? `${JSON.stringify({ error: message, field: field3 })}
` : `${message}
`
  );
  return code;
}
var record = {
  summary: "append one validated event, from flags or JSON on stdin, to the stage ledger",
  options: STRING_FLAGS([...EVENT_FLAGS, "ledger"]),
  async run(context2) {
    const given = await eventInput(context2);
    if ("error" in given) {
      return reject(context2, given.error, "event", given.code);
    }
    const opened = await openLedger(context2);
    if ("error" in opened) {
      return reject(context2, opened.error, "ledger");
    }
    const result = await opened.ledger.record(given.input);
    if (!result.ok) {
      return reject(context2, result.message, result.field);
    }
    context2.deps.stdout(
      context2.json ? `${JSON.stringify({ event: result.event })}
` : `recorded ${result.event.id} ${result.event.kind}
`
    );
    return 0;
  }
};
function filterFrom(options) {
  const filter = {};
  const text9 = (name) => {
    const value = options[name];
    return typeof value === "string" ? value : void 0;
  };
  for (const name of ["session", "pane", "idea"]) {
    const value = text9(name);
    if (value !== void 0) {
      filter[name] = value;
    }
  }
  const source = text9("source");
  if (source !== void 0) {
    if (!SOURCES.includes(source)) {
      return {
        error: `Invalid --source "${source}". Sources: ${SOURCES.join(", ")}.`
      };
    }
    filter.source = source;
  }
  const kind = text9("kind");
  if (kind !== void 0) {
    if (!KINDS2.includes(kind)) {
      return { error: `Invalid --kind "${kind}". Kinds: ${KINDS2.join(", ")}.` };
    }
    filter.kind = kind;
  }
  for (const name of ["since", "until"]) {
    const value = text9(name);
    if (value !== void 0) {
      if (!isTimestamp(value)) {
        return {
          error: `Invalid --${name} "${value}". Use an ISO 8601 UTC time such as 2026-01-02T03:04:05Z.`
        };
      }
      filter[name] = value;
    }
  }
  return { filter };
}
function line(event) {
  const where = [event.session, event.pane, event.idea].filter(
    (v) => v !== void 0
  );
  return [event.occurredAt, event.source, event.kind, ...where].join(" ");
}
var list = {
  summary: "list stage events, filtered by session, pane, idea, source, kind and time range (--since inclusive, --until exclusive, on occurredAt)",
  options: STRING_FLAGS([
    "session",
    "pane",
    "idea",
    "source",
    "kind",
    "since",
    "until",
    "ledger"
  ]),
  async run(context2) {
    const parsed = filterFrom(context2.options);
    if ("error" in parsed) {
      return reject(context2, parsed.error, "filter", 2);
    }
    const opened = await openLedger(context2);
    if ("error" in opened) {
      return reject(context2, opened.error, "ledger");
    }
    const { events, skipped } = await opened.ledger.list(parsed.filter);
    if (context2.json) {
      context2.deps.stdout(`${JSON.stringify({ events, skipped })}
`);
      return 0;
    }
    context2.deps.stdout(events.map((e) => `${line(e)}
`).join(""));
    if (skipped > 0) {
      context2.deps.stdout(`skipped ${skipped} malformed ledger line(s)
`);
    }
    return 0;
  }
};
var pollHerdrCommand = {
  summary: "read herdr's agent panes once and append only the changes (pane.spawned, pane.busy, pane.waiting, pane.closed) to the ledger; pane.closed means the pane no longer hosts an agent; safe to repeat from a wait loop, and one poll runs at a time",
  options: STRING_FLAGS(["ledger"]),
  async run(context2) {
    const opened = await openLedger(context2);
    if ("error" in opened) {
      return reject(context2, opened.error, "ledger");
    }
    const { runner, clock, fs } = context2.deps;
    const result = await pollHerdr({
      ledger: opened.ledger,
      runner,
      clock,
      fs
    });
    if (!result.ok) {
      return reject(context2, result.message, "herdr");
    }
    context2.deps.stdout(
      context2.json ? `${JSON.stringify({ recorded: result.recorded, events: result.events })}
` : `recorded ${result.recorded} herdr event(s)
`
    );
    return 0;
  }
};
var DEFAULT_REPO = "corekraft/kore";
var pollGithubCommand = {
  summary: "list issues, label events and PRs through gh and append issue.opened, issue.labelled, pr.opened and pr.merged (numbers, labels and GitHub times only, no titles or bodies); --since (default: the latest recorded GitHub event) only bounds what gh is asked for, since ids decide what is new; --repo to corekraft/kore; re-polling appends nothing, one poll runs at a time, and a rate limit is reported with its retry time",
  options: STRING_FLAGS(["ledger", "since", "repo"]),
  async run(context2) {
    const since = context2.options["since"];
    if (typeof since === "string" && !isTimestamp(since)) {
      return reject(
        context2,
        `Invalid --since "${since}". Use an ISO 8601 UTC time such as 2026-01-02T03:04:05Z.`,
        "since",
        2
      );
    }
    const repo = context2.options["repo"];
    if (typeof repo === "string" && !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      return reject(
        context2,
        `Invalid --repo "${repo}". Use owner/name, such as ${DEFAULT_REPO}.`,
        "repo",
        2
      );
    }
    const opened = await openLedger(context2);
    if ("error" in opened) {
      return reject(context2, opened.error, "ledger");
    }
    const { runner, clock, fs } = context2.deps;
    const result = await pollGithub({
      ledger: opened.ledger,
      runner,
      clock,
      fs,
      repo: typeof repo === "string" ? repo : DEFAULT_REPO,
      ...typeof since === "string" ? { since } : {}
    });
    if (!result.ok) {
      return reject(context2, result.message, "github");
    }
    context2.deps.stdout(
      context2.json ? `${JSON.stringify({ recorded: result.recorded, events: result.events })}
` : `recorded ${result.recorded} github event(s)
`
    );
    return 0;
  }
};
var ledgerCommands = {
  record,
  list,
  "poll-herdr": pollHerdrCommand,
  "poll-github": pollGithubCommand
};

// src/cli/flow-commands.ts
function parseTime(options, name) {
  const given = options[name];
  if (given === void 0) {
    return void 0;
  }
  if (typeof given !== "string" || !isTimestamp(given)) {
    return {
      error: `Invalid --${name} "${String(given)}". Use an ISO 8601 UTC time such as 2026-01-02T03:04:05Z.`
    };
  }
  return new Date(given);
}
function parseIdeas(given) {
  const parts = typeof given === "string" ? given.split(",") : [""];
  const ideas2 = parts.map((part) => /^#?(\d+)$/.exec(part.trim())?.[1]);
  if (ideas2.includes(void 0)) {
    return {
      error: `Invalid --idea "${String(given)}". Use issue numbers such as #12 or 12,13.`
    };
  }
  return ideas2.map((n) => `#${Number(n)}`);
}
function parseTimes(options) {
  const asOf = parseTime(options, "as-of");
  const since = parseTime(options, "since");
  const until = parseTime(options, "until");
  if (asOf !== void 0 && "error" in asOf) {
    return asOf;
  }
  if (since !== void 0 && "error" in since) {
    return since;
  }
  if (until !== void 0 && "error" in until) {
    return until;
  }
  if (since !== void 0 && until !== void 0 && since > until) {
    return {
      error: `Invalid --since ${since.toISOString()}: it is after --until ${until.toISOString()}. Swap them.`
    };
  }
  return {
    ...asOf === void 0 ? {} : { asOf },
    ...since === void 0 ? {} : { since },
    ...until === void 0 ? {} : { until }
  };
}
function parseFlags({ options, deps }) {
  const min = options["min-ideas"];
  let minCompletedIdeas = MIN_COMPLETED_IDEAS;
  if (min !== void 0) {
    minCompletedIdeas = typeof min === "string" ? Number(min) : Number.NaN;
    if (!/^\d+$/.test(String(min)) || minCompletedIdeas < 1) {
      return {
        error: `Invalid --min-ideas "${String(min)}". Use a whole number of at least 1.`
      };
    }
  }
  const trailing = options["trailing"];
  if (trailing !== void 0 && !/^[1-9]\d{0,8}$/.test(String(trailing))) {
    return {
      error: `Invalid --trailing "${String(trailing)}". Use a whole number of at least 1.`
    };
  }
  const times = parseTimes(options);
  if ("error" in times) {
    return times;
  }
  const { asOf, since, until } = times;
  const idea = options.idea === void 0 ? void 0 : parseIdeas(options.idea);
  if (idea !== void 0 && "error" in idea) {
    return idea;
  }
  return {
    asOf: asOf ?? deps.clock.now(),
    minCompletedIdeas,
    ...trailing === void 0 ? {} : { trailingIdeas: Number(trailing) },
    ...since === void 0 ? {} : { since },
    ...until === void 0 ? {} : { until },
    ...idea === void 0 ? {} : { ideas: idea }
  };
}
var seconds = (value) => `${Math.round(value)}s`;
function scopeLine({ since, until, ideas: ideas2 }) {
  const range = [
    since === null ? void 0 : `from ${since}`,
    until === null ? void 0 : `until ${until}`
  ].filter((part) => part !== void 0);
  const named = ideas2 === null ? [] : [`ideas ${ideas2.join(", ")}`];
  const parts = [...range, ...named];
  return parts.length === 0 ? "Covering the whole ledger" : `Covering ${parts.join(", ")}`;
}
var leadLine = ({
  ideas: ideas2,
  medianSeconds,
  maxSeconds
}) => medianSeconds === null || maxSeconds === null ? "Lead time: no completed ideas" : `Lead time: ${ideas2.length} ideas, median ${seconds(medianSeconds)}, max ${seconds(maxSeconds)}`;
function metricLine(label, metric2, trailing) {
  if (metric2.status === "insufficient history") {
    return `${label}: insufficient history, ${metric2.closedIdeas} of ${metric2.needed} closed ideas`;
  }
  const average = Math.round(metric2.trailingAverage * 100) / 100;
  return `${label}: ${metric2.currentIdea} ${metric2.current}, average of the ${trailing} ideas before it ${average}${metric2.worsened ? " (worsened)" : ""}`;
}
function text(report3) {
  const rows = report3.stages.map(
    (s) => [
      s.stage.padEnd(15),
      `active ${seconds(s.activeSeconds)}`.padEnd(16),
      `waiting ${seconds(s.waitingSeconds)}`.padEnd(17),
      `${s.events} events`.padEnd(11),
      `wip peak ${s.wip.peak} avg ${s.wip.average}`.padEnd(20),
      `toil start ${seconds(s.toil.startingSeconds)} stop ${seconds(s.toil.stoppingSeconds)} wait ${seconds(s.toil.waitingSeconds)} retry ${seconds(s.toil.retryingSeconds)}`
    ].join(" ")
  );
  const lines2 = [
    `Flow report as of ${report3.asOf}: ${report3.ideas.completed} of ${report3.ideas.total} ideas completed`,
    scopeLine(report3.scope),
    ...rows,
    leadLine(report3.leadTime),
    metricLine(
      "Tokens per idea",
      report3.metrics.tokensPerIdea,
      report3.metrics.trailingIdeas
    ),
    metricLine(
      "Sessions per idea",
      report3.metrics.sessionsPerIdea,
      report3.metrics.trailingIdeas
    ),
    `Unmapped events: ${report3.unmappedEvents}`,
    report3.bottleneck === null ? report3.bottleneckNote ?? "No bottleneck." : `Bottleneck: ${report3.bottleneck.stage} (${Math.round(report3.bottleneck.share * 100)}% of waiting)`
  ];
  if (report3.skippedLines > 0) {
    lines2.push(`skipped ${report3.skippedLines} malformed ledger line(s)`);
  }
  return `${lines2.join("\n")}
`;
}
async function loadCost({ deps }) {
  const root3 = await deps.root().catch(() => void 0);
  const file = root3 === void 0 ? void 0 : join2(root3, HARNESS_CONFIG);
  if (file === void 0 || !await deps.fs.exists(file)) {
    return { cost: DEFAULT_COST };
  }
  return parseHarnessConfig(await deps.fs.readFile(file), HARNESS_CONFIG);
}
var report = {
  summary: `map ledger events to stages; per stage active, waiting, event counts, toil (starting, stopping, waiting, retrying), work in progress (peak and average ideas open), lead time (first event to outcome; median and max), tokens and sessions per closed idea with a trailing average over the N closed ideas before the latest and a worsened flag (--trailing N, default 5, else cost.trailingIdeas; thresholds in ${HARNESS_CONFIG}), and the bottleneck (--min-ideas N, default ${MIN_COMPLETED_IDEAS}; --as-of TIME; --since TIME (inclusive) and --until TIME (exclusive) clip time at those edges and count only ideas open then, with lead time only for ideas whose outcome falls inside; --idea N|#N[,...] covers only those issues; --ledger PATH; --json is one object, version ${REPORT_VERSION}: version, asOf, scope, ideas, minCompletedIdeas, stages, leadTime, metrics, bottleneck, bottleneckNote, unmappedEvents, skippedLines)`,
  options: {
    "min-ideas": "string",
    trailing: "string",
    "as-of": "string",
    since: "string",
    until: "string",
    idea: "string",
    ledger: "string"
  },
  async run(context2) {
    const flags = parseFlags(context2);
    const { deps, json } = context2;
    const fail5 = (message, code) => {
      deps.stderr(
        json ? `${JSON.stringify({ error: message })}
` : `${message}
`
      );
      return code;
    };
    if ("error" in flags) {
      return fail5(flags.error, 2);
    }
    const cost = await loadCost(context2);
    if ("error" in cost) {
      return fail5(cost.error, 1);
    }
    const opened = await openLedger(context2);
    if ("error" in opened) {
      return fail5(opened.error, 1);
    }
    const { events, skipped } = await opened.ledger.list({});
    const printed = {
      ...buildReport(events, {
        ...flags,
        cost: {
          ...cost.cost,
          ...flags.trailingIdeas === void 0 ? {} : { trailingIdeas: flags.trailingIdeas }
        }
      }),
      skippedLines: skipped
    };
    deps.stdout(json ? `${JSON.stringify(printed)}
` : text(printed));
    return 0;
  }
};
var flowCommands = { report };

// src/cli/measurement.ts
var measurement = {
  ledger: ledgerCommands,
  flow: flowCommands
};

// src/idea/record.ts
var SAFETY_PATTERNS = [
  "no-behaviour-change",
  "feature-flagged",
  "dark-launched",
  "branch-by-abstraction",
  "expand-contract"
];
var IdeaError = class extends Error {
};
var IDEA_FILE = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
var REQUIRED2 = [
  ["summary", "summary"],
  ["hypothesis", "hypothesis"],
  ["expected-outcome", "expectedOutcome"],
  ["measurement", "measurement"],
  ["safety-pattern", "safetyPattern"],
  ["date", "date"]
];
function frontmatter(text9) {
  const lines2 = text9.split("\n");
  if (lines2[0] !== "---") {
    return null;
  }
  const keys = /* @__PURE__ */ new Map();
  for (const line2 of lines2.slice(1)) {
    if (line2 === "---") {
      return keys;
    }
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line2);
    if (match?.[1] !== void 0) {
      keys.set(match[1], (match[2] ?? "").trim());
    }
  }
  return null;
}
function parseIdea(path, text9) {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const name = IDEA_FILE.exec(file);
  if (name?.[1] === void 0 || name[2] === void 0) {
    throw new IdeaError(
      `${path} is not named NNNN-slug.md; rename it to a four-digit number and a lowercase slug.`
    );
  }
  const keys = frontmatter(text9);
  if (keys === null) {
    throw new IdeaError(
      `${path} has no frontmatter; start it with --- and the idea fields (see \`harness idea new --help\`).`
    );
  }
  const missing = REQUIRED2.filter(([key]) => !keys.get(key)).map(([k]) => k);
  if (missing.length > 0) {
    throw new IdeaError(
      `${path} is missing frontmatter ${missing.join(", ")}; add each as a key: value line.`
    );
  }
  const get = (key) => keys.get(key) ?? "";
  const heading = /^# Idea \d{4}: (.+)$/m.exec(text9)?.[1];
  const record4 = {
    number: name[1],
    slug: name[2],
    path,
    title: heading ?? get("summary"),
    summary: get("summary"),
    hypothesis: get("hypothesis"),
    expectedOutcome: get("expected-outcome"),
    measurement: get("measurement"),
    safetyPattern: get("safety-pattern"),
    date: get("date")
  };
  for (const key of ["outcome", "issue", "parent"]) {
    if (get(key) !== "") {
      record4[key] = get(key);
    }
  }
  return record4;
}
function scalar(flag, value) {
  const text9 = (value ?? "").replace(/\s+/g, " ").trim();
  if (text9 === "") {
    throw new IdeaError(`Missing --${flag}; pass a non-empty value.`);
  }
  if (/^[[{|>&*!-]/.test(text9)) {
    throw new IdeaError(
      `--${flag} must not start with "${text9.slice(0, 1)}"; frontmatter holds plain text, so reword it.`
    );
  }
  return text9;
}
function renderIdea(number, date, idea) {
  const lines2 = [
    "---",
    `summary: ${idea.summary}`,
    `hypothesis: ${idea.hypothesis}`,
    `expected-outcome: ${idea.expectedOutcome}`,
    `measurement: ${idea.measurement}`,
    `safety-pattern: ${idea.safetyPattern}`,
    `date: ${date}`
  ];
  if (idea.issue !== void 0) {
    lines2.push(`issue: ${idea.issue}`);
  }
  if (idea.parent !== void 0) {
    lines2.push(`parent: ${idea.parent}`);
  }
  lines2.push("---", "", `# Idea ${number}: ${idea.title}`, "");
  return lines2.join("\n");
}
function withIssue(text9, issue) {
  const lines2 = text9.split("\n");
  const end = lines2.indexOf("---", 1);
  if (lines2[0] !== "---" || end === -1) {
    throw new IdeaError("The idea has no frontmatter to record the issue in.");
  }
  const at = lines2.findIndex(
    (l, i) => i > 0 && i < end && l.startsWith("issue:")
  );
  if (at === -1) {
    lines2.splice(end, 0, `issue: ${issue}`);
  } else {
    lines2[at] = `issue: ${issue}`;
  }
  return lines2.join("\n");
}
var OUTCOME_HEADING = "## Outcome";
function outcomeRange(lines2) {
  const start = lines2.findIndex((l) => l.trimEnd() === OUTCOME_HEADING);
  if (start === -1) {
    return void 0;
  }
  const end = lines2.findIndex((l, i) => i > start && /^#{1,2} /.test(l));
  return [start, end === -1 ? lines2.length : end];
}
function outcomeSection(text9) {
  const lines2 = text9.split("\n");
  const range = outcomeRange(lines2);
  return range === void 0 ? void 0 : lines2.slice(...range).join("\n").replace(/\r/g, "").trim();
}
function withoutOutcome(text9) {
  const lines2 = text9.split("\n");
  const range = outcomeRange(lines2);
  return range === void 0 ? text9 : [...lines2.slice(0, range[0]), ...lines2.slice(range[1])].join("\n").trimEnd();
}
function withOutcome(text9, result, section) {
  const lines2 = text9.split("\n");
  const end = lines2.indexOf("---", 1);
  if (lines2[0] !== "---" || end === -1) {
    throw new IdeaError(
      "The idea has no frontmatter to record the outcome in."
    );
  }
  lines2.splice(end, 0, `outcome: ${result}`);
  return `${lines2.join("\n").trimEnd()}

${section.trim()}
`;
}

// src/idea/repository.ts
var INDEX2 = "docs/index.md";
var DIR = "docs/ideas";
var ATTEMPTS = 3;
var HEADING = "## Ideas";
var NEXT_SECTION = "## Operations and Guides";
var IdeaRepository = class {
  constructor(fs, clock, root3) {
    this.fs = fs;
    this.clock = clock;
    this.root = root3;
  }
  fs;
  clock;
  root;
  async list() {
    return await Promise.all((await this.listNames()).map((n) => this.read(n)));
  }
  /** Finds an idea by number (`1` or `0001`), slug, or file stem. */
  async get(ref) {
    const wanted = /^\d+$/.test(ref) ? ref.padStart(4, "0") : ref;
    const name = (await this.listNames()).find((n) => {
      const [, number, slug2] = IDEA_FILE.exec(n) ?? [];
      return wanted === number || wanted === slug2 || `${number}-${slug2}` === wanted;
    });
    if (name === void 0) {
      throw new IdeaError(
        `No idea matches "${ref}". Run \`harness idea list\` to see the ideas, or \`harness idea new\` to create one.`
      );
    }
    return await this.read(name);
  }
  /**
   * Creates the next numbered idea and indexes it; an existing slug is returned untouched.
   * The file is created exclusively, so a competing writer's file is never overwritten:
   * on a collision the listing is read again and the call retries.
   */
  async create(slug2, idea) {
    if (!await this.fs.exists(this.abs(INDEX2))) {
      throw new IdeaError(
        `${INDEX2} not found under ${this.root}; set CLAUDE_PROJECT_DIR to the repository root.`
      );
    }
    if (!SAFETY_PATTERNS.some((p) => p === idea.safetyPattern)) {
      throw new IdeaError(
        `--safety-pattern "${idea.safetyPattern}" is not recognised; use one of ${SAFETY_PATTERNS.join(", ")}.`
      );
    }
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const names3 = await this.listNames();
      const existing = names3.find((n) => IDEA_FILE.exec(n)?.[2] === slug2);
      if (existing !== void 0) {
        const record5 = await this.read(existing);
        await this.ensureIndexed(record5);
        return { created: false, record: record5 };
      }
      const taken = names3.map((n) => Number(n.slice(0, 4)));
      const number = String(Math.max(0, ...taken) + 1).padStart(4, "0");
      const path = `${DIR}/${number}-${slug2}.md`;
      const text9 = renderIdea(
        number,
        this.clock.now().toISOString().slice(0, 10),
        idea
      );
      try {
        await this.fs.createFile(this.abs(path), text9);
      } catch (error) {
        if (error.code === "EEXIST") {
          continue;
        }
        throw error;
      }
      const record4 = parseIdea(path, text9);
      await this.ensureIndexed(record4);
      return { created: true, record: record4 };
    }
    throw new IdeaError(
      `Another writer keeps creating ideas in ${DIR}; rerun \`harness idea new\` once it finishes.`
    );
  }
  /** The raw markdown of an idea. */
  async source(record4) {
    return await this.fs.readFile(this.abs(record4.path));
  }
  /** Records the idea's issue link in its frontmatter, touching nothing else. */
  async recordIssue(record4, issue) {
    await this.fs.writeFile(
      this.abs(record4.path),
      withIssue(await this.source(record4), issue)
    );
  }
  /** Records the outcome in the idea's frontmatter and as its `## Outcome` section, touching nothing else. */
  async recordOutcome(record4, result, section) {
    await this.fs.writeFile(
      this.abs(record4.path),
      withOutcome(await this.source(record4), result, section)
    );
  }
  abs(path) {
    return `${this.root}/${path}`;
  }
  async read(name) {
    const path = `${DIR}/${name}`;
    return parseIdea(path, await this.fs.readFile(this.abs(path)));
  }
  /** Lists the idea in the index unless an entry already points at it, so a rerun repairs a half-finished create. */
  async ensureIndexed(record4) {
    const index = await this.fs.readFile(this.abs(INDEX2));
    if (!index.includes(`](${record4.path.replace(/^docs\//, "")})`)) {
      await this.fs.writeFile(
        this.abs(INDEX2),
        addEntry(index, record4.path, record4.summary)
      );
    }
  }
  async listNames() {
    return await this.fs.exists(this.abs(DIR)) ? (await this.fs.readdir(this.abs(DIR))).filter((f) => IDEA_FILE.test(f)).sort() : [];
  }
};
function addEntry(index, path, summary) {
  const entry2 = `- [\`${path}\`](${path.replace(/^docs\//, "")}) \u2014 ${summary}`;
  const lines2 = index.split("\n");
  const start = lines2.indexOf(HEADING);
  if (start === -1) {
    const next = lines2.indexOf(NEXT_SECTION);
    const at = next === -1 ? lines2.length : next;
    const block2 = [HEADING, "", entry2, ""];
    if (next === -1 && lines2.at(-1) === "") {
      lines2.splice(lines2.length - 1, 0, "", ...block2.slice(0, -1));
    } else {
      lines2.splice(at, 0, ...block2);
    }
    return lines2.join("\n");
  }
  let end = lines2.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) {
    end = lines2.length;
  }
  while (end > start + 1 && lines2[end - 1] === "") {
    end--;
  }
  lines2.splice(end, 0, entry2);
  return lines2.join("\n");
}

// src/idea/sync.ts
var NOT_FOUND = /could not resolve to an issue|issue .*not found|no issue/i;
var ISSUE_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/;
function prose(text9) {
  const lines2 = withoutOutcome(text9).split("\n");
  const at = lines2.findIndex((l) => /^# Idea \d{4}: /.test(l));
  return (at === -1 ? "" : lines2.slice(at + 1).join("\n")).trim();
}
function renderBody(record4, text9) {
  const sections = [
    `<!-- Generated by \`harness idea sync\` from ${record4.path}. Edit that file; changes made here are overwritten. -->`,
    `## Summary

${record4.summary}`,
    `## Hypothesis

${record4.hypothesis}`,
    `## Expected outcome

${record4.expectedOutcome}`,
    `## Measurement

${record4.measurement}`,
    `## Safety pattern

${record4.safetyPattern}`
  ];
  const extra = prose(text9);
  if (extra !== "") {
    sections.push(extra);
  }
  return `${sections.join("\n\n")}
`;
}
var normal = (value) => value.replace(/\r\n/g, "\n").trimEnd();
function locate(issue) {
  const url = ISSUE_URL.exec(issue);
  if (url?.[1] !== void 0 && url[2] !== void 0) {
    return { number: url[2], repo: url[1] };
  }
  const bare = /^#?(\d+)$/.exec(issue.trim());
  return bare?.[1] === void 0 ? void 0 : { number: bare[1] };
}
var REPO_PROBLEM = /repositor/i;
function failure(what, stderr2) {
  const hint = REPO_PROBLEM.test(stderr2) ? "Check the repository named above, then rerun `harness idea sync`." : fix;
  return new IdeaError(`${what}: ${stderr2.trim()}. ${hint}`);
}
async function resolveRepo(gh, recorded) {
  if (recorded !== void 0) {
    return recorded;
  }
  const view = await gh(["repo", "view", "--json", "nameWithOwner"]);
  let name;
  try {
    name = JSON.parse(view.stdout).nameWithOwner;
  } catch {
    name = void 0;
  }
  if (view.code !== 0 || typeof name !== "string" || name === "") {
    throw failure("gh could not tell which repository this is", view.stderr);
  }
  return name;
}
var fix = "Check `gh auth status` and rerun `harness idea sync`.";
async function reconcile(gh, record4, body, at) {
  const title = record4.title.trim();
  const issue = record4.issue ?? "";
  const view = await gh([
    "issue",
    "view",
    at.number,
    "--repo",
    at.repo,
    "--json",
    "title,body"
  ]);
  if (view.code !== 0) {
    if (NOT_FOUND.test(view.stderr)) {
      return void 0;
    }
    throw failure(`gh could not read issue ${issue}`, view.stderr);
  }
  const current = parseView(view.stdout, issue);
  if (current.title.trim() === title && normal(current.body) === normal(body)) {
    return { action: "unchanged", issue };
  }
  const edit = await gh(
    [
      "issue",
      "edit",
      at.number,
      "--repo",
      at.repo,
      "--title",
      title,
      "--body-file",
      "-"
    ],
    body
  );
  if (edit.code !== 0) {
    throw failure(`gh could not update issue ${issue}`, edit.stderr);
  }
  return { action: "updated", issue };
}
async function syncIssue(runner, root3, record4, text9, recordLink) {
  const body = renderBody(record4, text9);
  const gh = async (args, input) => await runner.run("gh", args, {
    cwd: root3,
    ...input === void 0 ? {} : { input }
  });
  const at = record4.issue === void 0 ? void 0 : locate(record4.issue);
  if (record4.issue !== void 0 && at === void 0) {
    throw new IdeaError(
      `${record4.path} has issue "${record4.issue}", which is not an issue number or link; set it to e.g. 123 or https://github.com/<owner>/<repo>/issues/123.`
    );
  }
  const repo = await resolveRepo(gh, at?.repo);
  const existing = at === void 0 ? void 0 : await reconcile(gh, record4, body, { number: at.number, repo });
  if (existing !== void 0) {
    return existing;
  }
  const created = await gh(
    [
      "issue",
      "create",
      "--repo",
      repo,
      "--title",
      record4.title.trim(),
      "--body-file",
      "-"
    ],
    body
  );
  const url = ISSUE_URL.exec(created.stdout)?.[0];
  if (created.code !== 0) {
    throw failure("gh could not create the issue", created.stderr);
  }
  if (url === void 0) {
    throw new IdeaError(
      `gh reported success but printed no issue link, so the issue may exist: check the repository's issues for "${record4.title.trim()}" in ${repo}, add \`issue: <url>\` to ${record4.path}, then rerun \`harness idea sync\`; otherwise a duplicate is created.`
    );
  }
  try {
    await recordLink(url);
  } catch (error) {
    throw new IdeaError(
      `Created ${url} but could not record it in ${record4.path}: ${error instanceof Error ? error.message : String(error)}. Add \`issue: ${url}\` to its frontmatter, then rerun \`harness idea sync\`; otherwise a second issue is created.`
    );
  }
  return { action: "created", issue: url };
}
function parseView(stdout, issue) {
  try {
    const parsed = JSON.parse(stdout);
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      body: typeof parsed.body === "string" ? parsed.body : ""
    };
  } catch {
    throw new IdeaError(
      `gh returned unreadable output for issue ${issue}; rerun \`harness idea sync\`.`
    );
  }
}
async function issueTarget(runner, root3, record4) {
  if (record4.issue === void 0) {
    throw new IdeaError(
      `${record4.path} has no issue; run \`harness idea sync --idea ${record4.number}\` to create and link it first.`
    );
  }
  const at = locate(record4.issue);
  if (at === void 0) {
    throw new IdeaError(
      `${record4.path} has issue "${record4.issue}", which is not an issue number or link; set it to e.g. 123 or https://github.com/<owner>/<repo>/issues/123.`
    );
  }
  const gh = async (args, input) => await runner.run("gh", args, {
    cwd: root3,
    ...input === void 0 ? {} : { input }
  });
  return { number: at.number, repo: await resolveRepo(gh, at.repo) };
}

// src/idea/commands.ts
var FAILED = 1;
var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
async function repository({ deps }) {
  const root3 = await deps.root().catch((cause) => {
    throw new IdeaError(cause instanceof Error ? cause.message : String(cause));
  });
  return new IdeaRepository(deps.fs, deps.clock, root3);
}
async function guarded({ json, deps }, action) {
  try {
    await action();
    return 0;
  } catch (error) {
    if (!(error instanceof IdeaError)) {
      throw error;
    }
    const prefix = json ? `${JSON.stringify({ error: error.message })}
` : "";
    deps.stderr(`${prefix}${error.message}
`);
    return FAILED;
  }
}
function text2(options, key) {
  const value = options[key];
  return typeof value === "string" ? value : void 0;
}
function slugOf(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
}
function describe4(record4) {
  const lines2 = [
    `Idea ${record4.number}: ${record4.title}`,
    `Date: ${record4.date}`,
    `Summary: ${record4.summary}`,
    `Hypothesis: ${record4.hypothesis}`,
    `Expected outcome: ${record4.expectedOutcome}`,
    `Measurement: ${record4.measurement}`,
    `Safety pattern: ${record4.safetyPattern}`
  ];
  for (const [label, value] of [
    ["Outcome", record4.outcome],
    ["Issue", record4.issue],
    ["Parent", record4.parent]
  ]) {
    if (value !== void 0) {
      lines2.push(`${label}: ${value}`);
    }
  }
  lines2.push(`File: ${record4.path}`);
  return `${lines2.join("\n")}
`;
}
function parseNewIdea(options) {
  const title = scalar("title", text2(options, "title"));
  const slug2 = text2(options, "slug") ?? slugOf(title);
  if (!SLUG.test(slug2)) {
    throw new IdeaError(
      `Slug "${slug2}" is invalid; use lowercase letters, digits and single hyphens, e.g. cache-probe-results.`
    );
  }
  const idea = {
    title,
    summary: scalar("summary", text2(options, "summary") ?? title),
    hypothesis: scalar("hypothesis", text2(options, "hypothesis")),
    expectedOutcome: scalar(
      "expected-outcome",
      text2(options, "expected-outcome")
    ),
    measurement: scalar("measurement", text2(options, "measurement")),
    safetyPattern: scalar("safety-pattern", text2(options, "safety-pattern"))
  };
  for (const key of ["issue", "parent"]) {
    const value = text2(options, key);
    if (value !== void 0) {
      idea[key] = scalar(key, value);
    }
  }
  return { slug: slug2, idea };
}
var create = {
  summary: "create the next numbered idea record and index it (--title --hypothesis --expected-outcome --measurement --safety-pattern [--slug] [--summary] [--issue] [--parent])",
  options: {
    title: "string",
    slug: "string",
    summary: "string",
    hypothesis: "string",
    "expected-outcome": "string",
    measurement: "string",
    "safety-pattern": "string",
    issue: "string",
    parent: "string"
  },
  run(context2) {
    return guarded(context2, async () => {
      const { slug: slug2, idea } = parseNewIdea(context2.options);
      const { created, record: record4 } = await (await repository(context2)).create(slug2, idea);
      context2.deps.stdout(
        context2.json ? `${JSON.stringify({ created, ...record4 })}
` : `${created ? "Created" : "Already exists:"} ${record4.path}
`
      );
    });
  }
};
var show = {
  summary: "print one idea record (--idea <number or slug>)",
  options: { idea: "string" },
  run(context2) {
    return guarded(context2, async () => {
      const ref = text2(context2.options, "idea");
      if (ref === void 0 || ref.trim() === "") {
        throw new IdeaError(
          "Missing --idea; run `harness idea show --idea <number or slug>`, or `harness idea list` to see the ideas."
        );
      }
      const record4 = await (await repository(context2)).get(ref.trim());
      context2.deps.stdout(
        context2.json ? `${JSON.stringify(record4)}
` : describe4(record4)
      );
    });
  }
};
var list2 = {
  summary: "list every idea record in number order",
  run(context2) {
    return guarded(context2, async () => {
      const records2 = await (await repository(context2)).list();
      context2.deps.stdout(
        context2.json ? `${JSON.stringify(records2)}
` : records2.map((r) => `${r.number} ${r.outcome ?? "open"} ${r.title}
`).join("")
      );
    });
  }
};
var sync = {
  summary: "mirror one idea to its GitHub issue, creating it when missing and editing only when the body changed (--idea <number or slug>)",
  options: { idea: "string" },
  run(context2) {
    return guarded(context2, async () => {
      const ref = text2(context2.options, "idea");
      if (ref === void 0 || ref.trim() === "") {
        throw new IdeaError(
          "Missing --idea; run `harness idea sync --idea <number or slug>`, or `harness idea list` to see the ideas."
        );
      }
      const repo = await repository(context2);
      const record4 = await repo.get(ref.trim());
      const result = await syncIssue(
        context2.deps.runner,
        await context2.deps.root(),
        record4,
        await repo.source(record4),
        (url) => repo.recordIssue(record4, url)
      );
      context2.deps.stdout(
        context2.json ? `${JSON.stringify({ idea: record4.number, ...result })}
` : `Issue ${result.action}: ${result.issue}
`
      );
    });
  }
};
var ideaCommands = {
  new: create,
  list: list2,
  show,
  sync
};

// src/challenge/model.ts
var MAX_ROUNDS = 2;
var MARKER = /^<!-- harness-challenge idea=(\d{4}) round=(\d+) -->$/;
var NONE = "No open objections.";
var markerFor = (idea, round2) => `<!-- harness-challenge idea=${idea} round=${round2} -->`;
function renderRound(idea, round2, objections) {
  const body = objections.length === 0 ? NONE : ["Open objections:", "", ...objections.map((o) => `- ${o}`)].join("\n");
  return `${markerFor(idea, round2)}
## Challenge round ${round2} of ${MAX_ROUNDS}

${body}
`;
}
function parseRounds(idea, comments) {
  const rounds = [];
  for (const comment of comments) {
    const lines2 = comment.replace(/\r/g, "").split("\n");
    const found = MARKER.exec((lines2[0] ?? "").trim());
    if (found?.[1] !== idea || found[2] === void 0) {
      continue;
    }
    rounds.push({
      round: Number(found[2]),
      objections: lines2.filter((line2) => line2.startsWith("- ")).map((line2) => line2.slice(2).trim()).filter((line2) => line2 !== "")
    });
  }
  return rounds.sort((a, b) => a.round - b.round);
}
function parseObjections(input) {
  return input.split("\n").map((line2) => line2.replace(/^\s*[-*]\s+/, "").trim()).filter((line2) => line2 !== "");
}

// src/challenge/challenge.ts
var RoundLimit = class extends IdeaError {
  constructor(rounds, openObjections, message) {
    super(message);
    this.rounds = rounds;
    this.openObjections = openObjections;
  }
  rounds;
  openObjections;
};
var FIX = "Check `gh auth status`, then rerun `harness idea challenge`.";
function commentBodies(stdout, issue) {
  try {
    const view = JSON.parse(stdout);
    return Array.isArray(view.comments) ? view.comments.flatMap((c) => {
      const body = c?.body;
      return typeof body === "string" ? [body] : [];
    }) : [];
  } catch {
    throw new IdeaError(
      `gh returned unreadable output for issue ${issue}; ${FIX}`
    );
  }
}
async function challengeIdea(ctx, ref, objections) {
  const record4 = await ctx.repo.get(ref);
  const target = await issueTarget(ctx.runner, ctx.root, record4);
  const issue = `https://github.com/${target.repo}/issues/${target.number}`;
  const gh = (args, input) => ctx.runner.run("gh", args, {
    cwd: ctx.root,
    ...input === void 0 ? {} : { input }
  });
  const view = await gh([
    "issue",
    "view",
    target.number,
    "--repo",
    target.repo,
    "--json",
    "comments"
  ]);
  if (view.code !== 0) {
    throw new IdeaError(
      `gh could not read issue ${issue}: ${view.stderr.trim()}. ${FIX}`
    );
  }
  const rounds = parseRounds(record4.number, commentBodies(view.stdout, issue));
  if (rounds.length >= MAX_ROUNDS) {
    const open2 = rounds.at(-1)?.objections ?? [];
    throw new RoundLimit(
      rounds.length,
      open2,
      [
        `Idea ${record4.number} has used the limit of ${MAX_ROUNDS} challenge rounds, so it goes to a person to approve or reject (${issue}).`,
        open2.length === 0 ? "No open objections." : `Open objections:
${open2.map((o) => `- ${o}`).join("\n")}`
      ].join("\n")
    );
  }
  const round2 = rounds.length + 1;
  const post = await gh(
    [
      "issue",
      "comment",
      target.number,
      "--repo",
      target.repo,
      "--body-file",
      "-"
    ],
    renderRound(record4.number, round2, objections)
  );
  if (post.code !== 0) {
    throw new IdeaError(
      `gh could not post round ${round2} on ${issue}: ${post.stderr.trim()}. ${FIX}`
    );
  }
  return {
    idea: record4.number,
    round: round2,
    objections: [...objections],
    issue
  };
}

// src/cli/challenge-commands.ts
var FAILED2 = 1;
function text3(options, key) {
  const value = options[key];
  return typeof value === "string" ? value : void 0;
}
async function objectionsOf(context2) {
  const approve = context2.options["approve"] === true;
  if (approve) {
    return [];
  }
  const objections = parseObjections(await context2.deps.stdin());
  if (objections.length === 0) {
    throw new IdeaError(
      "No objections given: pipe them on stdin, one per line, or pass --approve when the idea has none left."
    );
  }
  return objections;
}
async function round(context2) {
  const { deps } = context2;
  const ref = text3(context2.options, "idea")?.trim();
  if (ref === void 0 || ref === "") {
    throw new IdeaError(
      "Missing --idea; run `harness idea challenge --idea <number or slug>`, or `harness idea list` to see the ideas."
    );
  }
  const objections = await objectionsOf(context2);
  const opened = await openLedger(context2);
  if ("error" in opened) {
    throw new IdeaError(opened.error);
  }
  const root3 = await deps.root().catch((cause) => {
    throw new IdeaError(cause instanceof Error ? cause.message : String(cause));
  });
  const done = await challengeIdea(
    {
      repo: new IdeaRepository(deps.fs, deps.clock, root3),
      runner: deps.runner,
      root: root3
    },
    ref,
    objections
  );
  const event = await opened.ledger.record({
    source: "claude",
    kind: "challenge.round",
    occurredAt: deps.clock.now().toISOString(),
    idea: done.idea,
    stage: "challenge",
    number: done.round,
    label: `objections:${done.objections.length}`
  });
  if (!event.ok) {
    throw new IdeaError(
      `Round ${done.round} was posted on ${done.issue}, but its ledger event was rejected: ${event.message} Fix the ledger; do not rerun, which would post another round.`
    );
  }
  deps.stdout(
    context2.json ? `${JSON.stringify(done)}
` : `Challenge round ${done.round} of ${MAX_ROUNDS} posted on ${done.issue}: ${done.objections.length === 0 ? "no open objections" : `${done.objections.length} open objection${done.objections.length === 1 ? "" : "s"}`}
`
  );
}
var challenge = {
  summary: "post one challenge round on the idea's issue and record it (--idea; objections one per line on stdin, or --approve for none; [--ledger]); refuses a third round and lists the open objections for a person",
  options: { idea: "string", approve: "boolean", ledger: "string" },
  async run(context2) {
    const { json, deps } = context2;
    try {
      await round(context2);
      return 0;
    } catch (error) {
      if (!(error instanceof IdeaError)) {
        throw error;
      }
      const detail2 = error instanceof RoundLimit ? {
        error: error.message,
        rounds: error.rounds,
        openObjections: error.openObjections
      } : { error: error.message };
      deps.stderr(
        `${json ? `${JSON.stringify(detail2)}
` : ""}${error.message}
`
      );
      return FAILED2;
    }
  }
};

// src/flag/overlay.ts
var ENVIRONMENTS = "infra/environments";
var FlagError = class extends Error {
};
function parse(path, text9) {
  try {
    const value = JSON.parse(text9);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value;
    }
  } catch {
  }
  throw new FlagError(
    `${path} is not a JSON object; environment overlays stay JSON-compatible YAML. Fix the syntax, then rerun.`
  );
}
function notADirectory(error) {
  if (error.code === "ENOTDIR") {
    return false;
  }
  throw error;
}
async function environments(fs, root3) {
  const names3 = await fs.readdir(`${root3}/${ENVIRONMENTS}`).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw new FlagError(
      `Cannot read ${ENVIRONMENTS} (${error instanceof Error ? error.message : String(error)}); fix its permissions, then rerun.`
    );
  });
  const found = [];
  for (const name of [...names3].sort()) {
    const overlay = `${root3}/${ENVIRONMENTS}/${name}/environment.yaml`;
    if (await fs.exists(overlay).catch(notADirectory)) {
      found.push(name);
    }
  }
  return found;
}
async function readOverlay(fs, root3, environment) {
  const path = `${ENVIRONMENTS}/${environment}/environment.yaml`;
  if (!(await environments(fs, root3)).includes(environment)) {
    throw new FlagError(
      `No environment "${environment}" has an overlay at ${path}. Environments: ${(await environments(fs, root3)).join(", ") || "none"}.`
    );
  }
  const text9 = await fs.readFile(`${root3}/${path}`);
  const features = parse(path, text9)["features"] ?? {};
  const valid = typeof features === "object" && features !== null && Object.values(features).every((v) => typeof v === "boolean");
  if (!valid) {
    throw new FlagError(
      `${path} has a features map that is not flag name to boolean (ADR 0077). Fix it, then rerun.`
    );
  }
  return {
    environment,
    path,
    text: text9,
    features
  };
}
function featuresSpan(text9) {
  const key = /["']?features["']?\s*:\s*\{/.exec(text9);
  if (key === null) {
    return void 0;
  }
  const open2 = key.index + key[0].length - 1;
  let depth = 0;
  for (let i = open2; i < text9.length; i++) {
    if (text9[i] === "{") {
      depth += 1;
    } else if (text9[i] === "}") {
      depth -= 1;
    }
    if (depth === 0) {
      return [open2, i + 1];
    }
  }
  return void 0;
}
var FALSE_ENTRY = /(["']?)([a-z][a-z0-9-]*)\1(\s*:\s*)false\b/g;
function withFlagOn(overlay, flag) {
  const span = featuresSpan(overlay.text);
  const block2 = span === void 0 ? "" : overlay.text.slice(...span);
  const entry2 = [...block2.matchAll(FALSE_ENTRY)].find((m) => m[2] === flag);
  if (span === void 0 || entry2 === void 0) {
    throw new FlagError(
      `${overlay.path} does not write ${flag} as false inside its features map, so the tool cannot edit it safely. Set it to false by hand, then rerun.`
    );
  }
  const end = span[0] + entry2.index + entry2[0].length;
  const text9 = `${overlay.text.slice(0, end - "false".length)}true${overlay.text.slice(end)}`;
  parse(overlay.path, text9);
  return text9;
}

// src/flag/proof.ts
function fieldBlock(section) {
  const body = section.split("\n").slice(1);
  const start = body.findIndex((line2) => line2.trim() !== "");
  const rest = start === -1 ? [] : body.slice(start);
  const end = rest.findIndex((line2) => line2.trim() === "");
  return end === -1 ? rest : rest.slice(0, end);
}
function lines(section) {
  const found = /* @__PURE__ */ new Map();
  for (const line2 of fieldBlock(section)) {
    const match = /^- ([A-Za-z]+): (.*)$/.exec(line2);
    if (match?.[1] !== void 0 && !found.has(match[1])) {
      found.set(match[1], (match[2] ?? "").trim());
    }
  }
  return found;
}
async function findProof(repo, flag, environment) {
  for (const record4 of await repo.list()) {
    const section = outcomeSection(await repo.source(record4));
    if (section === void 0) {
      continue;
    }
    const fields = lines(section);
    if (fields.get("Result") === "confirmed" && fields.get("Kind") === "verification" && fields.get("Source") === "live-run" && fields.get("Flag") === flag && fields.get("Environment") === environment) {
      return { idea: record4.number, path: record4.path };
    }
  }
  return void 0;
}

// src/flag/audit.ts
async function unprovenFlags(fs, clock, base) {
  const repo = new IdeaRepository(fs, clock, base);
  const unproven = [];
  for (const environment of await environments(fs, base)) {
    const overlay = await readOverlay(fs, base, environment);
    for (const [flag, on] of Object.entries(overlay.features)) {
      if (on && await findProof(repo, flag, environment) === void 0) {
        unproven.push({ flag, environment, path: overlay.path });
      }
    }
  }
  return unproven;
}
function unprovenLine(u) {
  return `Flag ${u.flag} is on in ${u.environment} (${u.path}) with no verification outcome. Set it back to false, then turn it on with \`harness flag activate ${u.flag} --environment ${u.environment}\` once a live run is recorded.`;
}

// src/cli/flag-commands.ts
var FAILED3 = 1;
function text4(options, key) {
  const value = options[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
async function guarded2({ json, deps }, action) {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof FlagError)) {
      throw error;
    }
    const prefix = json ? `${JSON.stringify({ error: error.message })}
` : "";
    deps.stderr(`${prefix}${error.message}
`);
    return FAILED3;
  }
}
async function root(context2) {
  return await context2.deps.root().catch((cause) => {
    throw new FlagError(cause instanceof Error ? cause.message : String(cause));
  });
}
async function recordActivation(ledger, { deps }, flag, environment, idea) {
  const event = await ledger.record({
    source: "claude",
    kind: "flag.activated",
    occurredAt: deps.clock.now().toISOString(),
    idea,
    label: `${flag}@${environment}`
  });
  if (!event.ok) {
    throw new FlagError(
      `${flag} is on in ${environment}, but its ledger event was rejected: ${event.message} Fix the ledger, then rerun \`harness flag activate ${flag} --environment ${environment}\` to record it.`
    );
  }
}
function activationTarget(context2) {
  const flag = context2.operand;
  if (flag === void 0) {
    throw new FlagError(
      "Missing flag name; run `harness flag activate <flag> --environment <env>`."
    );
  }
  const environment = text4(context2.options, "environment");
  if (environment === void 0) {
    throw new FlagError(
      "Missing --environment; run `harness flag activate <flag> --environment <env>`."
    );
  }
  return { flag, environment };
}
async function activateFlag(context2) {
  const { deps, json } = context2;
  const { flag, environment } = activationTarget(context2);
  const base = await root(context2);
  const overlay = await readOverlay(deps.fs, base, environment);
  if (!Object.hasOwn(overlay.features, flag)) {
    throw new FlagError(
      `${overlay.path} does not declare flag "${flag}". Declared: ${Object.keys(overlay.features).join(", ") || "none"}. Declare it as false first.`
    );
  }
  const proof = await findProof(
    new IdeaRepository(deps.fs, deps.clock, base),
    flag,
    environment
  );
  if (proof === void 0) {
    throw new FlagError(
      `No verification outcome records a live run of ${flag} in ${environment}, so ${overlay.path} is unchanged. Prove it live, then run \`harness outcome record --idea <number> --kind verification --source live-run --result confirmed --flag ${flag} --environment ${environment} --evidence <run> --summary <text>\`.`
    );
  }
  const opened = await openLedger(context2);
  if ("error" in opened) {
    throw new FlagError(opened.error);
  }
  const label = `${flag}@${environment}`;
  const logged = await opened.ledger.list({ kind: "flag.activated" });
  const recorded = logged.events.some((e) => e.label === label);
  const turningOn = overlay.features[flag] !== true;
  if (turningOn) {
    await deps.fs.writeFile(
      `${base}/${overlay.path}`,
      withFlagOn(overlay, flag)
    );
  }
  if (turningOn || !recorded) {
    await recordActivation(
      opened.ledger,
      context2,
      flag,
      environment,
      proof.idea
    );
  }
  deps.stdout(
    json ? `${JSON.stringify({ flag, environment, idea: proof.idea, proof: proof.path })}
` : `Flag ${flag} is on in ${environment}; proof: ${proof.path}
`
  );
  return 0;
}
async function auditFlags(context2) {
  const { deps, json } = context2;
  const base = await root(context2);
  const unproven = await unprovenFlags(deps.fs, deps.clock, base);
  if (unproven.length === 0) {
    deps.stdout(
      json ? `${JSON.stringify({ unproven })}
` : "Flag audit passed: no flag is on without proof.\n"
    );
    return 0;
  }
  const lines2 = unproven.map(unprovenLine);
  deps.stderr(
    json ? `${JSON.stringify({ unproven })}
` : `${lines2.join("\n")}
`
  );
  return FAILED3;
}
var activate = {
  summary: "turn a flag on in an environment overlay, only when a confirmed live-run verification outcome names that flag and environment; records a flag.activated ledger event (<flag> --environment <env> [--ledger])",
  operand: "flag",
  options: { environment: "string", ledger: "string" },
  run: (context2) => guarded2(context2, () => activateFlag(context2))
};
var audit = {
  summary: "fail when any flag in any environment overlay is on without a confirmed live-run verification outcome; kb-check reports it as a warning (audit mode, ADR 0080)",
  run: (context2) => guarded2(context2, () => auditFlags(context2))
};
var flagCommands = { activate, audit };

// src/plan/parser.ts
var FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
var UPCOMING_STEPS = 3;
function planNumber(name) {
  return Number.parseInt(name, 10);
}
function planStatus(markdown) {
  const frontmatter3 = FRONTMATTER.exec(markdown)?.[1];
  return frontmatter3 === void 0 ? void 0 : /^status: *(\S*) *$/m.exec(frontmatter3)?.[1];
}
function listItemSpans(markdown) {
  const items2 = [];
  let heading = "";
  let current = null;
  for (const [index, line2] of markdown.split("\n").entries()) {
    if (line2.startsWith("## ")) {
      heading = line2.slice(3).trim();
    }
    if (line2.startsWith("- ")) {
      current = { heading, text: line2.trim(), line: index, end: index + 1 };
      items2.push(current);
    } else if (current && /^\s+\S/.test(line2)) {
      current.text += ` ${line2.trim()}`;
      current.end = index + 1;
    } else {
      current = null;
    }
  }
  return items2;
}
function listItems(markdown) {
  return listItemSpans(markdown).map(({ heading, text: text9 }) => ({
    heading,
    text: text9
  }));
}
function openItems(markdown) {
  return listItems(markdown).filter((item) => item.text.startsWith("- [ ]")).map((item) => `${item.heading}: ${item.text}`);
}
function openSteps(markdown) {
  const counts = /* @__PURE__ */ new Map();
  for (const item of listItems(markdown)) {
    if (!item.text.startsWith("- [ ]")) {
      continue;
    }
    counts.set(item.heading, (counts.get(item.heading) ?? 0) + 1);
  }
  return counts;
}
function openCounts(markdown) {
  return [...openSteps(markdown)].map(([heading, count3]) => ({
    step: heading.split(":")[0] ?? heading,
    count: count3
  }));
}
var FENCE = /^\s*(```|~~~)/;
var LIST_MARKER = /^\s*([-*+]|\d+\.)\s/;
function nextBlocks(markdown) {
  const lines2 = markdown.split("\n");
  const blocks = [];
  let heading = "";
  let fenced = false;
  let open2 = null;
  for (const [index, line2] of lines2.entries()) {
    const fence = FENCE.test(line2);
    const stops = fence || !line2.trim() || line2.startsWith("#") || LIST_MARKER.test(line2);
    if (open2 && !fenced && !stops) {
      open2.text += ` ${line2.trim()}`;
      open2.end = index + 1;
      continue;
    }
    open2 = null;
    if (fence) {
      fenced = !fenced;
    } else if (!fenced && line2.startsWith("## ")) {
      heading = line2.slice(3).trim();
    } else if (!fenced && line2.startsWith("Next:")) {
      open2 = {
        step: heading,
        text: line2.slice(5).trim(),
        line: index,
        end: index + 1
      };
      blocks.push(open2);
    }
  }
  return blocks;
}
function nextStep(markdown) {
  const first = nextBlocks(markdown)[0];
  return first ? { step: first.step, text: first.text } : null;
}
function upcomingSteps(markdown) {
  const open2 = [...openSteps(markdown).keys()];
  const current = nextStep(markdown)?.step ?? open2[0];
  const headings2 = markdown.split("\n").filter((line2) => line2.startsWith("## ")).map((line2) => line2.slice(3).trim());
  const after = headings2.slice(headings2.indexOf(current ?? "") + 1);
  return after.filter((heading) => open2.includes(heading)).slice(0, UPCOMING_STEPS);
}
function activePlans(plans) {
  const active = [];
  let legacy;
  const byNumber2 = Object.keys(plans).sort(
    (a, b) => planNumber(b) - planNumber(a)
  );
  for (const name of byNumber2) {
    const markdown = plans[name] ?? "";
    if (!FRONTMATTER.test(markdown)) {
      if (legacy === void 0 && openItems(markdown).length > 0) {
        legacy = name;
      }
    } else if (planStatus(markdown) === "active") {
      active.push(name);
    }
  }
  if (legacy !== void 0) {
    active.push(legacy);
  }
  return active.sort((a, b) => planNumber(b) - planNumber(a));
}

// src/plan/store.ts
import { join as join3 } from "node:path";
var PLANS_DIR = "infra/plans";
async function readPlans(deps) {
  const root3 = await deps.root();
  let names3;
  try {
    names3 = (await deps.fs.readdir(join3(root3, PLANS_DIR))).filter(
      (n) => n.endsWith(".md")
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
  const plans = {};
  for (const name of names3) {
    plans[name] = await deps.fs.readFile(join3(root3, PLANS_DIR, name));
  }
  return plans;
}

// src/plan/active.ts
function describe5(plan2) {
  const open2 = plan2.open.map((o) => `${o.step} (${o.count})`).join(", ");
  const lines2 = [`${plan2.file}${plan2.default ? " (default)" : ""}`];
  lines2.push(`  Open items: ${open2 || "none"}`);
  if (plan2.next) {
    lines2.push(`  Next (${plan2.next.step}): ${plan2.next.text}`);
  }
  if (plan2.upcoming.length > 0) {
    lines2.push(`  Upcoming: ${plan2.upcoming.join("; ")}`);
  }
  return lines2.join("\n");
}
async function readActivePlans(deps) {
  const plans = await readPlans(deps);
  return activePlans(plans).map((name, index) => {
    const markdown = plans[name] ?? "";
    return {
      file: `${PLANS_DIR}/${name}`,
      name,
      default: index === 0,
      open: openCounts(markdown),
      next: nextStep(markdown),
      upcoming: upcomingSteps(markdown)
    };
  });
}
var planActive = {
  summary: "list the active plans, flagging the default (highest-numbered)",
  async run({ json, deps }) {
    const listed = await readActivePlans(deps);
    const names3 = listed.map((plan2) => plan2.name);
    if (json) {
      deps.stdout(
        `${JSON.stringify({ default: names3[0] ?? null, plans: listed })}
`
      );
    } else if (listed.length === 0) {
      deps.stdout(
        `No active plan: no file in ${PLANS_DIR} has "status: active" in its frontmatter.
`
      );
    } else {
      deps.stdout(`${listed.map(describe5).join("\n")}
`);
    }
    return 0;
  }
};

// src/plan/next.ts
import { join as join4 } from "node:path";

// src/plan/edits.ts
function trimCommon(edit, lines2) {
  const before2 = lines2.slice(edit.start, edit.end);
  let head = 0;
  while (head < before2.length && head < edit.lines.length && before2[head] === edit.lines[head]) {
    head++;
  }
  let tail = 0;
  while (tail < before2.length - head && tail < edit.lines.length - head && before2[before2.length - 1 - tail] === edit.lines[edit.lines.length - 1 - tail]) {
    tail++;
  }
  const kept = { start: edit.start + head, end: edit.end - tail };
  const after = edit.lines.slice(head, edit.lines.length - tail);
  return kept.start === kept.end && after.length === 0 ? null : { ...kept, lines: after };
}

// src/plan/plan-edit.ts
function normalize(text9) {
  return text9.replace(/\s+/g, " ").trim();
}
function choosePlan(plans, requested) {
  const names3 = Object.keys(plans);
  if (requested !== void 0) {
    const named = /^\d+$/.test(requested) ? names3.filter((n) => n.startsWith(`${requested}-`)) : [];
    if (named.length > 1) {
      throw new CommandError(
        `Plan number "${requested}" is shared by ${named.join(" and ")}. Rename one so each plan number is unique.`
      );
    }
    const name = named[0];
    if (name === void 0) {
      throw new CommandError(
        `No plan numbered "${requested}" in ${PLANS_DIR}. Run \`harness plan active\` to list the plans.`
      );
    }
    return name;
  }
  const active = activePlans(plans);
  if (active.length === 0) {
    throw new CommandError(
      `No active plan: no file in ${PLANS_DIR} has "status: active". Name one with --plan N.`
    );
  }
  if (active.length > 1) {
    throw new CommandError(
      `${active.length} plans are active (${active.join(", ")}), so there is no single default. Pass --plan N.`
    );
  }
  return active[0] ?? "";
}
function apply(lines2, edits) {
  const out = [...lines2];
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out.splice(edit.start, edit.end - edit.start, ...edit.lines);
  }
  return out;
}
function toChanges(lines2, edits) {
  return edits.flatMap((edit) => trimCommon(edit, lines2) ?? []).sort((a, b) => a.start - b.start).map((edit) => ({
    line: edit.start + 1,
    before: lines2.slice(edit.start, edit.end),
    after: edit.lines
  }));
}
function renderChanges(head, changes) {
  const body = changes.flatMap((c) => [
    `  line ${c.line}:`,
    ...c.before.map((l) => `  - ${l}`),
    ...c.after.map((l) => `  + ${l}`)
  ]);
  return `${[head, ...body].join("\n")}
`;
}

// src/plan/next.ts
var NEXT = "Next:";
function removals(lines2) {
  return nextBlocks(lines2.join("\n")).map(({ line: line2, end }) => {
    const blankBefore = line2 > 0 && (lines2[line2 - 1] ?? "").trim() === "";
    const blankAfter = end < lines2.length && (lines2[end] ?? "").trim() === "";
    return {
      start: line2,
      end: blankBefore && blankAfter ? end + 1 : end,
      lines: []
    };
  });
}
function currentHeading(lines2, markdown) {
  const open2 = openCounts(markdown).map((c) => c.step);
  const held = nextStep(markdown)?.step.split(":")[0];
  const step = held !== void 0 && open2.includes(held) ? held : open2[0];
  const index = lines2.findIndex(
    (l) => l.startsWith("## ") && l.slice(3).trim().split(":")[0] === step
  );
  if (step === void 0 || index < 0) {
    throw new CommandError(
      "The plan has no open item, so there is no current step to put a Next: line under. Add an unchecked item, or use `harness plan clear-next`."
    );
  }
  return index;
}
function insertion(lines2, heading, text9) {
  const blank = (lines2[heading + 1] ?? "").trim() === "";
  const start = blank ? heading + 2 : heading + 1;
  return {
    start,
    end: start,
    lines: blank ? [`${NEXT} ${text9}`, ""] : ["", `${NEXT} ${text9}`, ""]
  };
}
function withInsertion(lines2, removed, added) {
  const merged = removed.find((r) => r.start === added.start);
  const end = merged?.end ?? added.start;
  const followedByBlank = (lines2[end] ?? "").trim() === "";
  const inserted = followedByBlank && added.lines.at(-1) === "" ? added.lines.slice(0, -1) : added.lines;
  return merged ? [
    ...removed.filter((r) => r !== merged),
    { start: merged.start, end: merged.end, lines: inserted }
  ] : [...removed, { ...added, lines: inserted }];
}
async function write(deps, json, options) {
  const plans = await readPlans(deps);
  const name = choosePlan(plans, options.planOption);
  const markdown = plans[name] ?? "";
  const lines2 = markdown.split("\n");
  const edits = options.edits(lines2, markdown);
  const changes = toChanges(lines2, edits);
  const file = `${PLANS_DIR}/${name}`;
  const written2 = !options.dryRun && changes.length > 0;
  if (written2) {
    await deps.fs.writeFile(
      join4(await deps.root(), file),
      apply(lines2, edits).join("\n")
    );
  }
  if (json) {
    deps.stdout(
      `${JSON.stringify({ plan: file, dryRun: options.dryRun, written: written2, changes })}
`
    );
  } else if (changes.length === 0) {
    deps.stdout(`${options.unchanged} in ${file}
`);
  } else {
    deps.stdout(renderChanges(options.headline(file, options.dryRun), changes));
  }
  return 0;
}
var planNext = {
  summary: 'set the single Next: line under the current step (--text "<line>" [--plan N] [--dry-run]) and remove any other, reporting every changed line',
  options: { plan: "string", text: "string", "dry-run": "boolean" },
  async run({ json, deps, options }) {
    const raw = options["text"];
    const plan2 = options["plan"];
    const text9 = typeof raw === "string" ? normalize(raw) : "";
    if (text9 === "") {
      throw new CommandError(
        'Missing --text "<line>": say the first concrete action and any state the files cannot show.'
      );
    }
    return await write(deps, json, {
      planOption: typeof plan2 === "string" ? plan2 : void 0,
      dryRun: options["dry-run"] === true,
      headline: (file, dry) => `${dry ? "Would set" : "Set"} Next: in ${file}`,
      edits: (lines2, markdown) => withInsertion(
        lines2,
        removals(lines2),
        insertion(lines2, currentHeading(lines2, markdown), text9)
      ),
      unchanged: `Next: already reads that way`
    });
  }
};
var planClearNext = {
  summary: "remove the Next: line ([--plan N] [--dry-run]) and report every changed line",
  options: { plan: "string", "dry-run": "boolean" },
  async run({ json, deps, options }) {
    const plan2 = options["plan"];
    return await write(deps, json, {
      planOption: typeof plan2 === "string" ? plan2 : void 0,
      dryRun: options["dry-run"] === true,
      headline: (file, dry) => `${dry ? "Would clear" : "Cleared"} Next: in ${file}`,
      edits: (lines2) => removals(lines2),
      unchanged: "No Next: line to clear"
    });
  }
};

// src/plan/tick.ts
import { join as join5 } from "node:path";

// src/plan/totals.ts
var TOTALS = /as of \d{4}-\d{2}-\d{2}: (\d+) local, (\d+) managed(\s+)cluster, (\d+) release(\s+)pipeline/;
function totalsEdits(lines2, range, className, date) {
  const firstClass = lines2.findIndex(
    (l, i) => i > range[0] && i < range[1] && l.startsWith("### ")
  );
  const introEnd = firstClass < 0 ? range[1] : firstClass;
  const intro = lines2.slice(range[0], introEnd).join("\n");
  const match = TOTALS.exec(intro);
  if (match === null) {
    return /\bas of\b/.test(intro) ? "The open-item totals line is not in the form `as of YYYY-MM-DD: N local, N managed cluster, N release pipeline`, so it cannot be recounted. Fix its wording, or tick the item by hand." : [];
  }
  const lower = className.toLowerCase();
  if (!["local", "managed", "release"].some((c) => lower.startsWith(c))) {
    return `The list class "${className}" is not Local, Managed cluster or Release pipeline, so the totals cannot be recounted. Rename the heading, or tick the item by hand.`;
  }
  const [local, managed, release] = [match[1], match[2], match[4]].map(
    Number
  );
  const next = {
    local: local - (lower.startsWith("local") ? 1 : 0),
    managed: managed - (lower.startsWith("managed") ? 1 : 0),
    release: release - (lower.startsWith("release") ? 1 : 0)
  };
  const text9 = `as of ${date}: ${next.local} local, ${next.managed} managed${match[3]}cluster, ${next.release} release${match[5]}pipeline`;
  const changed = intro.replace(TOTALS, text9).split("\n");
  const before2 = intro.split("\n");
  const edits = [];
  for (const [i, line2] of changed.entries()) {
    if (line2 !== before2[i]) {
      edits.push({ start: range[0] + i, end: range[0] + i + 1, lines: [line2] });
    }
  }
  return edits;
}

// src/plan/lists.ts
var SECTION = "## Where each open item can be done";
var HEADER = /^- (.+?) \((\d+)\): /;
var LEAD = /^and (\w+)(\s+)exit(\s+)(?:criterion|criteria):(\s+)/;
var NUMBERS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten"
];
var MIN_SCORE = 0.6;
var MARGIN = 0.15;
function sectionRange(lines2) {
  const start = lines2.indexOf(SECTION);
  if (start < 0) {
    return null;
  }
  const next = lines2.findIndex((l, i) => i > start && l.startsWith("## "));
  return [start, next < 0 ? lines2.length : next];
}
function entriesIn(lines2, from, to) {
  const entries = [];
  for (let i = from; i < to; i++) {
    const line2 = lines2[i] ?? "";
    const step = HEADER.exec(line2)?.[1];
    if (step === void 0) {
      continue;
    }
    let end = i + 1;
    while (end < to && /^\s+\S/.test(lines2[end] ?? "")) {
      end++;
    }
    entries.push({
      start: i,
      end,
      step,
      raw: lines2.slice(i, end).join("\n")
    });
    i = end - 1;
  }
  return entries;
}
function segmentsOf(raw) {
  const bodyStart = HEADER.exec(raw)?.[0].length ?? 0;
  const trimmed = raw.trimEnd();
  const bodyEnd = trimmed.endsWith(".") ? trimmed.length - 1 : trimmed.length;
  const pieces = [];
  let depth = 0;
  let from = bodyStart;
  for (let i = bodyStart; i < bodyEnd; i++) {
    const c = raw[i];
    if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
    }
    if (c === ";" && depth === 0) {
      pieces.push([from, i]);
      from = i + 1;
    }
  }
  pieces.push([from, bodyEnd]);
  let exit = false;
  return pieces.map(([a, b]) => {
    const text9 = raw.slice(a, b);
    const start = a + (text9.length - text9.trimStart().length);
    const end = b - (text9.length - text9.trimEnd().length);
    const lead = LEAD.exec(raw.slice(start, end))?.[0];
    exit ||= lead !== void 0;
    return { start, end, itemStart: start + (lead?.length ?? 0), exit };
  });
}
function words(text9) {
  return new Set(
    (text9.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 4)
  );
}
function score(item, segment) {
  const own2 = words(segment.replace(/\([^)]*\)/g, " "));
  if (own2.size === 0) {
    return 0;
  }
  return [...own2].filter((w) => item.has(w)).length / own2.size;
}
function lowered(raw, segment) {
  const lead = LEAD.exec(raw.slice(segment.start, segment.end));
  if (lead === null) {
    return raw;
  }
  const word = lead[1] ?? "";
  const parsed = /^\d+$/.test(word) ? Number(word) : NUMBERS.indexOf(word);
  if (parsed < 1) {
    return raw;
  }
  const count3 = parsed - 1;
  const shown = /^\d+$/.test(word) ? String(count3) : NUMBERS[count3] ?? word;
  const noun = count3 === 1 ? "criterion" : "criteria";
  const [, , gap1, gap2, gap3] = lead;
  const text9 = `and ${shown}${gap1}exit${gap2}${noun}:${gap3}`;
  return raw.slice(0, segment.start) + text9 + raw.slice(segment.start + lead[0].length);
}
function sharedNote(raw, segments, index) {
  for (const [i, segment] of segments.entries()) {
    const text9 = raw.slice(segment.itemStart, segment.end);
    const note = /\([^)]*\b(both|all)\b[^)]*\)/i.exec(text9);
    const covered = note?.[1]?.toLowerCase() === "all" || index === i || index === i - 1;
    if (note !== null && covered) {
      return note[0];
    }
  }
  return void 0;
}
function without(raw, segments, index) {
  const target = segments[index];
  if (target === void 0 || segments.length === 1) {
    return null;
  }
  const next = segments[index + 1];
  const previous = segments[index - 1];
  const [from, to] = next === void 0 ? [previous?.end ?? 0, target.end] : [target.itemStart, next.start];
  const cut = raw.slice(0, from) + raw.slice(to);
  const lead = segments.find((s) => s.exit);
  const others = segments.filter((s) => s.exit && s !== target).length;
  return target.exit && lead !== void 0 && others > 0 ? lowered(cut, lead) : cut;
}
function classOf(lines2, entry2, from) {
  for (let i = entry2.start; i >= from; i--) {
    const heading = /^### (.+)$/.exec(lines2[i] ?? "")?.[1];
    if (heading !== void 0) {
      return heading;
    }
  }
  return "";
}
function locate2(entries, step, itemText) {
  const item = words(itemText);
  const scored = entries.flatMap(
    (entry2) => segmentsOf(entry2.raw).map((segment, index, all) => ({
      entry: entry2,
      all,
      index,
      score: score(item, entry2.raw.slice(segment.itemStart, segment.end))
    }))
  );
  scored.sort((a, b) => b.score - a.score);
  const [best, runnerUp] = scored;
  const close3 = runnerUp !== void 0 && runnerUp.score >= MIN_SCORE && (best?.score ?? 0) - runnerUp.score <= MARGIN;
  if (best === void 0 || best.score < MIN_SCORE || close3) {
    return {
      error: `Cannot tell which list entry under ${step} holds this item. Reword the list entry to share words with the item, or tick it by hand.`
    };
  }
  return best;
}
function listEdits(lines2, step, itemText, date) {
  const range = sectionRange(lines2);
  if (range === null) {
    return { edits: [] };
  }
  const entries = entriesIn(lines2, range[0], range[1]).filter(
    (e) => e.step === step
  );
  if (entries.length === 0) {
    return {
      error: `The open-item lists have no entry for ${step}. Add the item to its list, or tick it by hand.`
    };
  }
  const best = locate2(entries, step, itemText);
  if ("error" in best) {
    return best;
  }
  const shared = sharedNote(best.entry.raw, best.all, best.index);
  if (shared !== void 0) {
    return {
      error: `The note ${shared} in the ${step} list entry covers more than one item, so removing this one would leave it wrong. Edit the entry by hand, or reword the note.`
    };
  }
  const rest = without(best.entry.raw, best.all, best.index);
  const replaced = rest === null ? [] : rest.replace(
    /^(- .+? \()(\d+)(\): )/,
    (_, a, n, c) => `${a}${Number(n) - 1}${c}`
  ).split("\n");
  const entryEdit = trimCommon(
    { start: best.entry.start, end: best.entry.end, lines: replaced },
    lines2
  );
  const totals = totalsEdits(
    lines2,
    range,
    classOf(lines2, best.entry, range[0]),
    date
  );
  if (typeof totals === "string") {
    return { error: totals };
  }
  return { edits: [...entryEdit === null ? [] : [entryEdit], ...totals] };
}

// src/plan/tick.ts
var OPEN = "- [ ]";
function chooseItem(markdown, wanted) {
  const needle = normalize(wanted);
  const checkbox = listItemSpans(markdown).filter(
    (i) => /^- \[[ xX]\]/.test(i.text)
  );
  const matching = checkbox.filter((i) => normalize(i.text).includes(needle));
  const open2 = matching.filter((i) => i.text.startsWith(OPEN));
  if (open2.length === 1) {
    return open2[0];
  }
  if (open2.length > 1) {
    throw new CommandError(
      `"${wanted}" matches ${open2.length} open items. Use a longer, more specific part of the item text.`
    );
  }
  const done = matching.length > 0 ? " It is already ticked." : "";
  throw new CommandError(
    `"${wanted}" matches no open item.${done} Run \`harness plan active\` to see the open items.`
  );
}
function tickEdit(lines2, item) {
  const first = lines2[item.line] ?? "";
  return {
    start: item.line,
    end: item.line + 1,
    lines: [`- [x]${first.slice(OPEN.length)}`]
  };
}
function describe6(file, step, text9, dryRun, changes) {
  return renderChanges(
    `${dryRun ? "Would tick" : "Ticked"} ${step}: ${text9} in ${file}`,
    changes
  );
}
async function tick(deps, json, item, planOption, dryRun) {
  const plans = await readPlans(deps);
  const name = choosePlan(plans, planOption);
  const markdown = plans[name] ?? "";
  const lines2 = markdown.split("\n");
  const span = chooseItem(markdown, item);
  const step = span.heading.split(":")[0] ?? span.heading;
  const text9 = normalize(span.text.slice(OPEN.length));
  const date = localDate(deps.clock.now());
  const lists = listEdits(lines2, step, text9, date);
  if ("error" in lists) {
    throw new CommandError(lists.error);
  }
  const edits = [tickEdit(lines2, span), ...lists.edits];
  const changes = toChanges(lines2, edits);
  const file = `${PLANS_DIR}/${name}`;
  if (!dryRun) {
    await deps.fs.writeFile(
      join5(await deps.root(), file),
      apply(lines2, edits).join("\n")
    );
  }
  deps.stdout(
    json ? `${JSON.stringify({ plan: file, item: { step, text: text9 }, dryRun, written: !dryRun, changes })}
` : describe6(file, step, text9, dryRun, changes)
  );
  return 0;
}
var planTick = {
  summary: 'tick one open item (--item "<text>" [--plan N] [--dry-run]), update the open-item lists and counts, and report every changed line',
  options: { plan: "string", item: "string", "dry-run": "boolean" },
  async run({ json, deps, options }) {
    const item = options["item"];
    const plan2 = options["plan"];
    if (typeof item !== "string" || item.trim() === "") {
      throw new CommandError(
        'Missing --item "<text>": say which open item to tick.'
      );
    }
    return await tick(
      deps,
      json,
      item,
      typeof plan2 === "string" ? plan2 : void 0,
      options["dry-run"] === true
    );
  }
};

// src/cli/status-command.ts
var RECENT = 10;
function stageOf2(event) {
  return event.source === "github" ? GITHUB_STAGES[event.kind] : void 0;
}
function recentStages(events) {
  return events.flatMap((event) => {
    const stage = stageOf2(event);
    if (stage === void 0) {
      return [];
    }
    const recent = {
      occurredAt: event.occurredAt,
      stage,
      kind: event.kind
    };
    if (event.number !== void 0) {
      recent.number = event.number;
    }
    if (event.idea !== void 0) {
      recent.idea = event.idea;
    }
    return [recent];
  }).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, RECENT);
}
async function ideas({ deps }) {
  const repository2 = new IdeaRepository(deps.fs, deps.clock, await deps.root());
  const items2 = (await repository2.list()).map((record4) => ({
    number: record4.number,
    title: record4.title,
    state: record4.outcome ?? "open"
  }));
  const byState = {};
  for (const { state } of items2) {
    byState[state] = (byState[state] ?? 0) + 1;
  }
  return { byState, items: items2 };
}
var statusCommand = {
  summary: "report open plan items, ideas by state and recent ledger stages; read-only, for the concierge",
  async run(context2) {
    const opened = await openLedger(context2);
    if ("error" in opened) {
      throw new CommandError(opened.error);
    }
    const { events, skipped } = await opened.ledger.list({});
    const status2 = {
      plans: await readActivePlans(context2.deps),
      ideas: await ideas(context2),
      ledger: { recent: recentStages(events), skipped }
    };
    if (context2.json) {
      context2.deps.stdout(`${JSON.stringify(status2)}
`);
      return 0;
    }
    const lines2 = status2.plans.map(
      (plan2) => `${plan2.file}: ${plan2.open.map((o) => `${o.step} (${o.count})`).join(", ") || "no open items"}`
    );
    lines2.push(
      `Ideas: ${Object.entries(status2.ideas.byState).map(([state, count3]) => `${count3} ${state}`).join(", ") || "none"}`
    );
    for (const r of status2.ledger.recent) {
      lines2.push(`${r.occurredAt} ${r.stage} ${r.kind}`);
    }
    context2.deps.stdout(`${lines2.join("\n")}
`);
    return 0;
  }
};

// src/outcome/model.ts
var OUTCOME_KINDS = ["experiment", "usage", "verification"];
var OUTCOME_SOURCES = [
  "live-run",
  "journal",
  "eval-history",
  "comparison"
];
var RESULTS = ["confirmed", "refuted", "inconclusive"];
var labelFor = (result) => `outcome:${result}`;
var markerFor2 = (record4) => `<!-- harness outcome idea ${record4.number} -->`;
function choice(flag, allowed, value) {
  if (value === void 0 || value.trim() === "") {
    throw new IdeaError(
      `Missing --${flag}; pass one of ${allowed.join(", ")}.`
    );
  }
  const found = allowed.find((a) => a === value.trim());
  if (found === void 0) {
    throw new IdeaError(
      `--${flag} "${value}" is not recognised; use one of ${allowed.join(", ")}.`
    );
  }
  return found;
}
function text5(flag, value, hint) {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") {
    throw new IdeaError(`Missing --${flag}; ${hint}.`);
  }
  return trimmed;
}
function parseOutcome(options) {
  const kind = choice("kind", OUTCOME_KINDS, options.kind);
  const source = choice("source", OUTCOME_SOURCES, options.source);
  const result = choice("result", RESULTS, options.result);
  const evidence = text5(
    "evidence",
    options.evidence,
    "name the run, journal entry, eval record or comparison it was measured on"
  ).replace(/\s+/g, " ");
  const summary = text5(
    "summary",
    options.summary,
    "state what was observed against the idea's expected outcome"
  );
  if (summary.includes("<!--") || options.evidence?.includes("<!--") === true) {
    throw new IdeaError(
      "--summary and --evidence must not contain an HTML comment; it could forge the marker that tells a rerun the outcome is posted, so reword it."
    );
  }
  if (/^- [A-Za-z]+:/m.test(summary)) {
    throw new IdeaError(
      '--summary must not start a line with "- Name:"; it could override a recorded field such as Flag or Result, so reword it.'
    );
  }
  if (/^#/m.test(summary)) {
    throw new IdeaError(
      "--summary must not start a line with #; it would open a new section in the idea, so reword it."
    );
  }
  const flag = parseFlag(kind, source, options.flag, options.environment);
  return { kind, source, result, evidence, summary, ...flag };
}
var FLAG_NAME = /^[a-z][a-z0-9-]*$/;
function parseFlag(kind, source, name, environment) {
  const given = [name, environment].map((v) => (v ?? "").trim());
  if (given.every((v) => v === "")) {
    return {};
  }
  for (const [flag, value] of [
    ["flag", given[0]],
    ["environment", given[1]]
  ]) {
    if (value === "") {
      const other = flag === "flag" ? "environment" : "flag";
      throw new IdeaError(
        `Missing --${flag}; a flag outcome names both --flag and --environment (got only --${other}).`
      );
    }
    if (!FLAG_NAME.test(value ?? "")) {
      throw new IdeaError(
        `--${flag} "${value}" must be lowercase letters, digits and hyphens, starting with a letter.`
      );
    }
  }
  if (kind !== "verification" || source !== "live-run") {
    throw new IdeaError(
      `--flag proves a flag only on --kind verification with --source live-run (got ${kind} from ${source}); a different outcome cannot activate it.`
    );
  }
  return { flag: { name: given[0] ?? "", environment: given[1] ?? "" } };
}
function renderSection(outcome, date) {
  return [
    "## Outcome",
    "",
    `- Result: ${outcome.result}`,
    `- Kind: ${outcome.kind}`,
    `- Source: ${outcome.source}`,
    ...outcome.flag === void 0 ? [] : [
      `- Flag: ${outcome.flag.name}`,
      `- Environment: ${outcome.flag.environment}`
    ],
    `- Evidence: ${outcome.evidence}`,
    `- Recorded: ${date}`,
    "",
    outcome.summary
  ].join("\n");
}
function followUpOf(record4, result) {
  return {
    // The number keeps the slug unique when long slugs share a prefix.
    slug: `follow-up-${record4.number}-${record4.slug}`.slice(0, 60).replace(/-+$/, ""),
    idea: {
      title: `Follow up: ${record4.title}`,
      summary: `Follow up on idea ${record4.number} after a ${result} outcome`,
      hypothesis: `After a ${result} outcome on idea ${record4.number}, revisit: ${record4.hypothesis}`,
      expectedOutcome: record4.expectedOutcome,
      measurement: record4.measurement,
      safetyPattern: record4.safetyPattern,
      parent: record4.number
    }
  };
}

// src/outcome/publish.ts
var FIX2 = "Check `gh auth status`, then rerun `harness outcome close`.";
function names(value, key) {
  return Array.isArray(value) ? value.flatMap((v) => {
    const found = v?.[key];
    return typeof found === "string" ? [found] : [];
  }) : [];
}
function parseView2(stdout, target) {
  try {
    const view = JSON.parse(stdout);
    return {
      open: view["state"] !== "CLOSED",
      labels: names(view["labels"], "name"),
      comments: names(view["comments"], "body")
    };
  } catch {
    throw new IdeaError(
      `gh returned unreadable output for issue ${target.number}; ${FIX2}`
    );
  }
}
function labelFlags(have, wanted) {
  const stale = have.filter((l) => l.startsWith("outcome:") && l !== wanted);
  return [
    ...have.includes(wanted) ? [] : ["--add-label", wanted],
    ...stale.flatMap((l) => ["--remove-label", l])
  ];
}
function missingLabel(stderr2, wanted, repo, idea) {
  return /not found/i.test(stderr2) && stderr2.includes(wanted) ? `The label "${wanted}" does not exist on ${repo}; create it with \`gh label create ${wanted} --repo ${repo}\`, then rerun \`harness outcome close --idea ${idea}\`.` : void 0;
}
async function publishOutcome(runner, root3, target, outcome) {
  const gh = async (args, input, explain) => {
    const done = await runner.run("gh", args, {
      cwd: root3,
      ...input === void 0 ? {} : { input }
    });
    if (done.code !== 0) {
      const reason = explain?.(done.stderr);
      if (reason !== void 0) {
        throw new IdeaError(reason);
      }
      throw new IdeaError(
        `gh ${args.slice(0, 2).join(" ")} failed for issue ${target.number}: ${done.stderr.trim()}. ${FIX2}`
      );
    }
    return done.stdout;
  };
  const at = ["--repo", target.repo];
  const view = parseView2(
    await gh([
      "issue",
      "view",
      target.number,
      ...at,
      "--json",
      "state,labels,comments"
    ]),
    target
  );
  const published = {
    commented: false,
    labelled: false,
    closed: false
  };
  const wanted = labelFor(outcome.result);
  const flags = labelFlags(view.labels, wanted);
  if (flags.length > 0) {
    await gh(
      ["issue", "edit", target.number, ...at, ...flags],
      void 0,
      (stderr2) => missingLabel(stderr2, wanted, target.repo, outcome.idea)
    );
    published.labelled = true;
  }
  if (!view.comments.some((body) => body.includes(outcome.marker))) {
    await gh(
      ["issue", "comment", target.number, ...at, "--body-file", "-"],
      outcome.comment
    );
    published.commented = true;
  }
  if (view.open) {
    await gh(["issue", "close", target.number, ...at]);
    published.closed = true;
  }
  return published;
}

// src/outcome/outcome.ts
async function finish(ctx, record4, result, target) {
  let followUp;
  if (result !== "confirmed") {
    const next = followUpOf(record4, result);
    followUp = (await ctx.repo.create(next.slug, next.idea)).record.path;
  }
  const section = outcomeSection(await ctx.repo.source(record4)) ?? "";
  const comment = [
    markerFor2(record4),
    section,
    ...followUp === void 0 ? [] : [`Follow-up idea: ${followUp}`]
  ].join("\n\n");
  const published = await publishOutcome(ctx.runner, ctx.root, target, {
    idea: record4.number,
    result,
    marker: markerFor2(record4),
    comment: `${comment}
`
  });
  return {
    idea: record4.number,
    result,
    issue: `https://github.com/${target.repo}/issues/${target.number}`,
    ...followUp === void 0 ? {} : { followUp },
    published
  };
}
async function recordOutcome(ctx, ref, outcome) {
  const record4 = await ctx.repo.get(ref);
  if (record4.outcome !== void 0) {
    throw new IdeaError(
      `${record4.path} already has an outcome (${record4.outcome}); an outcome is recorded once. Run \`harness outcome close --idea ${record4.number}\` to finish publishing it.`
    );
  }
  const target = await issueTarget(ctx.runner, ctx.root, record4);
  const date = ctx.clock.now().toISOString().slice(0, 10);
  await ctx.repo.recordOutcome(
    record4,
    outcome.result,
    renderSection(outcome, date)
  );
  return await finish(ctx, record4, outcome.result, target);
}
async function closeOutcome(ctx, ref) {
  const record4 = await ctx.repo.get(ref);
  const recorded = record4.outcome;
  if (recorded === void 0) {
    throw new IdeaError(
      `${record4.path} has no recorded outcome, so its issue stays open. Run \`harness outcome record --idea ${record4.number} --kind <experiment|usage|verification> --source <live-run|journal|eval-history|comparison> --evidence <reference> --result <confirmed|refuted|inconclusive> --summary <text>\`.`
    );
  }
  const result = RESULTS.find((r) => r === recorded);
  if (result === void 0 || outcomeSection(await ctx.repo.source(record4)) === void 0) {
    throw new IdeaError(
      `${record4.path} has an outcome line "${recorded}" that the outcome tool did not write (it needs one of ${RESULTS.join(", ")} and an ## Outcome section). Remove it and run \`harness outcome record --idea ${record4.number}\`.`
    );
  }
  const target = await issueTarget(ctx.runner, ctx.root, record4);
  return await finish(ctx, record4, result, target);
}

// src/cli/outcome-commands.ts
var FAILED4 = 1;
function text6(options, key) {
  const value = options[key];
  return typeof value === "string" ? value : void 0;
}
async function guarded3({ json, deps }, action) {
  try {
    await action();
    return 0;
  } catch (error) {
    if (!(error instanceof IdeaError)) {
      throw error;
    }
    const prefix = json ? `${JSON.stringify({ error: error.message })}
` : "";
    deps.stderr(`${prefix}${error.message}
`);
    return FAILED4;
  }
}
function ideaRef(context2, verb) {
  const ref = text6(context2.options, "idea")?.trim();
  if (ref === void 0 || ref === "") {
    throw new IdeaError(
      `Missing --idea; run \`harness outcome ${verb} --idea <number or slug>\`, or \`harness idea list\` to see the ideas.`
    );
  }
  return ref;
}
async function withLedger(context2) {
  const opened = await openLedger(context2);
  if ("error" in opened) {
    throw new IdeaError(opened.error);
  }
  return opened.ledger;
}
async function conclusion(context2, verb) {
  const ledger = await withLedger(context2);
  const ref = ideaRef(context2, verb);
  const { deps } = context2;
  const root3 = await deps.root().catch((cause) => {
    throw new IdeaError(cause instanceof Error ? cause.message : String(cause));
  });
  const ctx = {
    repo: new IdeaRepository(deps.fs, deps.clock, root3),
    runner: deps.runner,
    clock: deps.clock,
    root: root3
  };
  const done = verb === "record" ? await recordOutcome(
    ctx,
    ref,
    parseOutcome({
      kind: text6(context2.options, "kind"),
      source: text6(context2.options, "source"),
      result: text6(context2.options, "result"),
      evidence: text6(context2.options, "evidence"),
      summary: text6(context2.options, "summary"),
      flag: text6(context2.options, "flag"),
      environment: text6(context2.options, "environment")
    })
  ) : await closeOutcome(ctx, ref);
  const logged = await ledger.list({ idea: done.idea, kind: "outcome" });
  if (logged.events.length === 0) {
    const event = await ledger.record({
      source: "github",
      kind: "outcome",
      occurredAt: deps.clock.now().toISOString(),
      idea: done.idea,
      label: labelFor(done.result),
      number: Number(/(\d+)$/.exec(done.issue)?.[1])
    });
    if (!event.ok) {
      throw new IdeaError(
        `The outcome was published, but its ledger event was rejected: ${event.message} Fix the ledger, then rerun \`harness outcome close --idea ${done.idea}\` to record the event.`
      );
    }
  }
  deps.stdout(
    context2.json ? `${JSON.stringify(done)}
` : `Idea ${done.idea} ${done.result}; issue closed: ${done.issue}${done.followUp === void 0 ? "" : `
Follow-up idea: ${done.followUp}`}
`
  );
}
var record2 = {
  summary: `record an idea's measured outcome in its markdown, post it to the issue with one outcome:* label, close the issue, and open a follow-up idea when refuted or inconclusive (--idea --kind ${OUTCOME_KINDS.join("|")} --source ${OUTCOME_SOURCES.join("|")} --evidence <reference> --result ${RESULTS.join("|")} --summary <text> [--flag <name> --environment <env>, only on a live-run verification] [--ledger])`,
  options: {
    idea: "string",
    kind: "string",
    source: "string",
    evidence: "string",
    result: "string",
    summary: "string",
    flag: "string",
    environment: "string",
    ledger: "string"
  },
  run(context2) {
    return guarded3(context2, () => conclusion(context2, "record"));
  }
};
var close = {
  summary: "finish closing an idea whose outcome is recorded (comment, one outcome:* label, close); refused with no gh call when no outcome is recorded (--idea [--ledger])",
  options: { idea: "string", ledger: "string" },
  run(context2) {
    return guarded3(context2, () => conclusion(context2, "close"));
  }
};
var outcomeCommands = { record: record2, close };

// src/cli/records.ts
var records = {
  idea: { ...ideaCommands, challenge },
  outcome: outcomeCommands,
  flag: flagCommands,
  // `harness status`: the one command of its domain, so it takes no command word.
  status: { "": statusCommand }
};

// src/hook/feedback.ts
import { tmpdir as tmpdir2 } from "node:os";
import { join as join8 } from "node:path";

// src/hook/feedback-tokens.ts
import { tmpdir } from "node:os";
import { join as join6 } from "node:path";
var tokenStateFile = (session2) => join6(
  tmpdir(),
  `kore-tokens-${(typeof session2 === "string" ? session2 : "default").replace(/[^\w.-]/g, "_")}.json`
);
var EMPTY = { offset: 0, total: 0 };
function usageOf(raw) {
  try {
    const value = JSON.parse(raw);
    const usage2 = value.message?.usage;
    if (value.type !== "assistant" || usage2 === void 0) {
      return void 0;
    }
    const count3 = (key) => {
      const n = usage2[key];
      return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
    };
    const id = value.message?.id;
    return {
      ...typeof id === "string" ? { id } : {},
      tokens: count3("input_tokens") + count3("output_tokens") + count3("cache_creation_input_tokens")
    };
  } catch {
    return void 0;
  }
}
function advance(state, text9) {
  const end = text9.lastIndexOf("\n") + 1;
  let { total, lastId, lastTokens } = state;
  for (const raw of text9.slice(0, end).split("\n")) {
    const usage2 = usageOf(raw);
    if (usage2 === void 0) {
      continue;
    }
    total += usage2.id !== void 0 && usage2.id === lastId ? usage2.tokens - (lastTokens ?? 0) : usage2.tokens;
    lastId = usage2.id;
    lastTokens = usage2.tokens;
  }
  return {
    offset: state.offset + Buffer.byteLength(text9.slice(0, end)),
    total,
    ...lastId === void 0 ? {} : { lastId },
    ...lastTokens === void 0 ? {} : { lastTokens }
  };
}
function parseState(text9) {
  try {
    const value = JSON.parse(text9);
    const { offset, total, lastId, lastTokens } = value;
    return typeof offset === "number" && typeof total === "number" && Number.isSafeInteger(offset) && offset >= 0 && total >= 0 ? {
      offset,
      total,
      ...typeof lastId === "string" ? { lastId } : {},
      ...typeof lastTokens === "number" ? { lastTokens } : {}
    } : EMPTY;
  } catch {
    return EMPTY;
  }
}
async function readTokens(fs, path, stateFile) {
  try {
    if (typeof path !== "string" || path === "") {
      return { total: 0, grew: false };
    }
    const before2 = await fs.readFile(stateFile).then(parseState, () => EMPTY);
    const after = advance(before2, await fs.readFrom(path, before2.offset));
    if (after.offset !== before2.offset) {
      await fs.writeFile(stateFile, JSON.stringify(after));
    }
    return { total: after.total, grew: after.total !== before2.total };
  } catch {
    return { total: 0, grew: false };
  }
}

// src/hook/ledger-event.ts
import { join as join7 } from "node:path";
var ledgerRoots = /* @__PURE__ */ new WeakMap();
function ledgerRoot(deps) {
  let root3 = ledgerRoots.get(deps);
  if (root3 === void 0) {
    root3 = mainRoot(deps);
    ledgerRoots.set(deps, root3);
  }
  return root3;
}
async function recordEvent(deps, kind, call, outcome, extra = {}) {
  try {
    const session2 = call.session_id;
    if (typeof session2 !== "string" || session2 === "") {
      return;
    }
    const main = await ledgerRoot(deps);
    if (main === void 0) {
      return;
    }
    const pane = deps.env["HERDR_PANE_ID"];
    const event = {
      source: "claude",
      kind,
      occurredAt: deps.clock.now().toISOString(),
      session: session2,
      ...typeof pane === "string" && pane !== "" ? { pane } : {},
      ...kind.startsWith("tool.") && typeof call.tool_name === "string" ? { tool: call.tool_name } : {},
      ...outcome === void 0 ? {} : { outcome },
      ...extra
    };
    await new Ledger(
      deps.fs,
      deps.clock,
      deps.ids,
      join7(main, DEFAULT_LEDGER)
    ).record(event);
  } catch {
  }
}

// src/hook/feedback.ts
var KORE_SOURCE_DIR = "tools/kore/src/";
var KORE = {
  bin: "tools/kore/node_modules/.bin",
  project: "tools/kore"
};
var HARNESS_SOURCE_DIRS = ["tools/harness/src/", "tools/harness/tests/"];
var HARNESS = {
  bin: "tools/harness/node_modules/.bin",
  project: "tools/harness"
};
function relativeTo(filePath, root3) {
  const prefix = `${root3}/`;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}
function isTrackedSource(filePath, root3) {
  const relative3 = relativeTo(filePath, root3);
  return relative3.startsWith(KORE_SOURCE_DIR) && relative3.endsWith(".ts");
}
function isHarnessSource(filePath, root3) {
  const relative3 = relativeTo(filePath, root3);
  return HARNESS_SOURCE_DIRS.some((dir) => relative3.startsWith(dir)) && relative3.endsWith(".ts");
}
var MAX_LINES = 40;
function bound(output, command) {
  const lines2 = output.split("\n");
  if (lines2.length <= MAX_LINES) {
    return output;
  }
  const cut = lines2.length - MAX_LINES;
  return `${lines2.slice(0, MAX_LINES).join("\n")}
... ${cut} more lines cut. Run \`${command}\` to see all.`;
}
var asCall = (payload) => typeof payload === "object" && payload !== null ? payload : {};
var isEdit = (call) => call.tool_name === void 0 || call.tool_name === "Write" || call.tool_name === "Edit";
var OK = {};
var fail2 = (message) => ({
  code: 2,
  stderr: `${message}
`
});
async function postEditFor(call, deps, project, tracked, formatFix) {
  const filePath = call.tool_input?.file_path;
  if (typeof filePath !== "string" || !tracked(filePath, deps.root)) {
    return OK;
  }
  await deps.mark(project.project);
  const lint = await deps.run(`${deps.root}/${project.bin}/oxlint`, [
    "--deny-warnings",
    filePath
  ]);
  if (lint.status !== 0) {
    const details = bound(
      lint.output,
      `${project.bin}/oxlint --deny-warnings ${filePath}`
    );
    return fail2(
      `oxlint reported problems in ${filePath}. Fix them before continuing.
${details}`
    );
  }
  const format2 = await deps.run(`${deps.root}/${project.bin}/prettier`, [
    "--check",
    filePath
  ]);
  if (format2.status !== 0) {
    const details = bound(
      format2.output,
      `${project.bin}/prettier --check ${filePath}`
    );
    return fail2(
      `${filePath} is not formatted. ${formatFix(filePath)}
${details}`
    );
  }
  return OK;
}
async function stopFor(call, deps, project, message) {
  if (call.stop_hook_active || !await deps.isMarked(project.project)) {
    return OK;
  }
  const check2 = await deps.run("npm", [
    "--prefix",
    project.project,
    "run",
    "check",
    "--silent"
  ]);
  if (check2.status !== 0) {
    const details = bound(
      check2.output,
      `npm --prefix ${project.project} run check`
    );
    return fail2(`${message}
${details}`);
  }
  await deps.clear(project.project);
  return OK;
}
async function postEdit(payload, deps) {
  const call = asCall(payload);
  if (!isEdit(call)) {
    return OK;
  }
  const kore = await postEditFor(
    call,
    deps,
    KORE,
    isTrackedSource,
    (filePath) => `Run \`${KORE.bin}/prettier --write ${filePath}\`.`
  );
  if (kore.code !== void 0) {
    return kore;
  }
  return await postEditFor(
    call,
    deps,
    HARNESS,
    isHarnessSource,
    (filePath) => `Run \`mise run format ${filePath}\`.`
  );
}
async function stop(payload, deps) {
  const call = asCall(payload);
  const kore = await stopFor(
    call,
    deps,
    KORE,
    "Typecheck failed after your TypeScript changes. Fix it before finishing."
  );
  if (kore.code !== void 0) {
    return kore;
  }
  return await stopFor(
    call,
    deps,
    HARNESS,
    "The harness typecheck failed after your TypeScript changes. Fix it before finishing."
  );
}
async function recordStop(deps, call) {
  await recordEvent(deps, "session.stop", call);
  const { total, grew } = await readTokens(
    deps.fs,
    call.transcript_path,
    tokenStateFile(call.session_id)
  );
  if (grew && total > 0) {
    await recordEvent(deps, "token.usage", call, void 0, { tokens: total });
  }
}
function feedbackDeps(deps, root3, call) {
  const marker = (project) => join8(
    tmpdir2(),
    `kore-${project === HARNESS.project ? "harness" : "ts"}-changed-${typeof call.session_id === "string" ? call.session_id : "default"}`
  );
  return {
    root: root3,
    async run(command, args) {
      const result = await deps.runner.run(command, args, { cwd: root3 });
      return {
        status: result.code,
        output: `${result.stdout}${result.stderr}`.trim()
      };
    },
    mark: (project) => deps.fs.writeFile(marker(project), ""),
    isMarked: (project) => deps.fs.exists(marker(project)),
    clear: (project) => deps.fs.remove(marker(project))
  };
}
var MODES2 = ["post-edit", "stop", "tool-failure"];
async function feedback(mode, payload, deps) {
  if (mode === void 0 || !MODES2.includes(mode)) {
    throw new CommandError(
      `Unknown feedback mode "${mode ?? ""}". Modes: ${MODES2.join(", ")}.`
    );
  }
  if (payload === void 0) {
    return OK;
  }
  const call = asCall(payload);
  const root3 = deps.env["CLAUDE_PROJECT_DIR"] || (typeof call.cwd === "string" && call.cwd !== "" ? call.cwd : deps.cwd);
  if (mode === "tool-failure") {
    await recordEvent(deps, "tool.end", call, "failure");
    return OK;
  }
  let recorded = Promise.resolve();
  if (mode === "post-edit") {
    recorded = recordEvent(deps, "tool.end", call, "success");
  } else if (!call.stop_hook_active) {
    recorded = recordStop(deps, call);
  }
  const checks = feedbackDeps(deps, root3, call);
  try {
    return mode === "stop" ? await stop(payload, checks) : await postEdit(payload, checks);
  } finally {
    await recorded;
  }
}

// src/hook/guard-verdict.ts
var block = (rule, message) => ({
  action: "block",
  rule,
  message: `[guard:${rule}] ${message}`
});
var warn = (rule, message) => ({
  action: "warn",
  rule,
  message: `[guard:${rule}] ${message}`
});
var allow = { action: "allow" };
function applyMode(finding2, ctx) {
  if (finding2 === null) {
    return finding2;
  }
  const action = ctx.modeOf(finding2.rule) === "audit" ? "warn" : "block";
  return { ...finding2, action };
}
function weigh(findings2) {
  const hits = findings2.filter((finding2) => finding2 !== null);
  const blocked = hits.find((hit) => hit.action === "block");
  if (blocked) {
    return blocked;
  }
  const warnings = hits.filter(
    (hit, index) => hits.findIndex((h) => h.rule === hit.rule) === index
  );
  const [first] = warnings;
  if (first === void 0) {
    return allow;
  }
  return {
    ...first,
    message: warnings.map((hit) => hit.message).join("\n"),
    rules: warnings.map((hit) => hit.rule)
  };
}

// src/hook/guard-append-only.ts
var APPEND_ONLY = /(^|[/\s>'"=])(\.claude\/evals\/history\.jsonl|\.kore\/state\/journal\/[^/\s'"]*\.jsonl|\.kore\/state\/ledger\.jsonl)$/;
var isAppendOnly = (path) => APPEND_ONLY.test(path);
var appendOnlyWarn = (path) => warn(
  "append-only",
  `${path} is an append-only record: .claude/evals/history.jsonl is owned by eval.mjs, .kore/state/journal/*.jsonl by kore, .kore/state/ledger.jsonl by the harness ledger tool (\`harness ledger record\`). Instead, append through the owning script (eval.mjs, kore, harness ledger); never edit, truncate, move, or remove it by hand.`
);
var TRUNCATING_REDIRECT = /^(?:\d*|&)>(?!>)(.*)$/;
var PROTECTED_DIRS = /* @__PURE__ */ new Set([".kore", ".kore/state", ".kore/state/journal"]);
function isProtectedDir(arg, root3) {
  let path = arg.replace(/^\.\//, "").replace(/\/+$/, "");
  const base = root3.replace(/\/+$/, "");
  if (base && path.startsWith(`${base}/`)) {
    path = path.slice(base.length + 1);
  }
  return PROTECTED_DIRS.has(path);
}
function truncatedTarget(segment, matches3) {
  for (let i = 0; i < segment.length; i++) {
    const match = TRUNCATING_REDIRECT.exec(segment[i]);
    if (!match) {
      continue;
    }
    const target = (match[1].replace(/^\|/, "") || segment[i + 1]) ?? "";
    if (matches3(target)) {
      return target;
    }
  }
  return void 0;
}
var inPlace = (arg) => /^-[A-Za-z]*i/.test(arg) || arg.startsWith("--in-place");
function rewrittenPath(name, args, matches3) {
  const rewrites = (candidates) => candidates.find((arg) => matches3(arg));
  const operands = args.filter((arg) => !arg.startsWith("-"));
  const appends = args.some((arg) => arg === "-a" || arg === "--append");
  if (["rm", "mv", "truncate"].includes(name) || name === "sed" && args.some(inPlace)) {
    return rewrites(args);
  }
  if (name === "tee" && !appends) {
    return rewrites(operands);
  }
  return name === "cp" ? rewrites(operands.slice(-1)) : void 0;
}
function checkAppendOnly(name, args, segment, root3) {
  if (name === "rm" || name === "mv") {
    const dir = args.find(
      (arg) => !arg.startsWith("-") && isProtectedDir(arg, root3)
    );
    if (dir) {
      return appendOnlyWarn(dir);
    }
  }
  const path = writtenPath(name, args, segment, isAppendOnly);
  return path ? appendOnlyWarn(path) : null;
}
function writtenPath(name, args, segment, matches3) {
  return truncatedTarget(segment, matches3) ?? rewrittenPath(name, args, matches3);
}

// src/hook/guard-guardrails.ts
var ENTRY = /"rule"\s*:\s*"([a-z0-9-]+)"[^}]*?"mode"\s*:\s*"(audit|enforce)"/g;
var OBJECT = /\{[^{}]*"rule"\s*:\s*"([a-z0-9-]+)"[^{}]*\}/g;
var DENY = /"deny"\s*:\s*\[([^\]]*)\]/;
var MODE = /"mode"\s*:\s*"(audit|enforce)"/g;
var modes = (source) => new Map(
  [...source.matchAll(ENTRY)].map((m) => [m[1], m[2]])
);
function denies(source) {
  const found = /* @__PURE__ */ new Map();
  for (const [object, rule] of source.matchAll(OBJECT)) {
    const list3 = DENY.exec(object)?.[1];
    if (list3 !== void 0) {
      found.set(
        rule,
        [...list3.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1])
      );
    }
  }
  return found;
}
var PERMISSION2 = /"((?:Bash|Read|Edit|Write)\([^"]*\))"/g;
var permissions = (source) => [...source.matchAll(PERMISSION2)].map((m) => m[1]);
function weakened(previous, after) {
  const was = denies(previous);
  if (was.size === 0) {
    const kept = permissions(after);
    return permissions(previous).filter((p) => !kept.includes(p));
  }
  const now = denies(after);
  return [...was].filter(([rule, patterns]) => {
    const kept = now.get(rule);
    return kept === void 0 || patterns.some((p) => !kept.includes(p));
  }).map(([rule]) => rule);
}
var count2 = (source, mode) => [...source.matchAll(MODE)].filter((m) => m[1] === mode).length;
function demoted(previous, after) {
  const was = modes(previous);
  const named = [...modes(after)].filter(([rule, mode]) => mode === "audit" && was.get(rule) === "enforce").map(([rule]) => rule);
  if (named.length > 0) {
    return named;
  }
  const unnamed = was.size === 0 && modes(after).size === 0;
  return unnamed && count2(after, "audit") > count2(previous, "audit") && count2(previous, "enforce") > count2(after, "enforce") ? ["a rule"] : [];
}
function checkGuardrailDemotion(relative3, previous, after) {
  if (relative3 !== INVENTORY_PATH) {
    return null;
  }
  const rules2 = demoted(previous, after);
  const weak = weakened(previous, after);
  if (rules2.length === 0 && weak.length === 0) {
    return null;
  }
  const problems = [
    ...rules2.length > 0 ? [`turns ${rules2.join(", ")} from enforce to audit by hand`] : [],
    ...weak.length > 0 ? [
      `removes, narrows or renames deny patterns (${weak.join(", ")}) by hand`
    ] : []
  ];
  return warn(
    "guardrail-demotion",
    `${relative3} ${problems.join(" and ")}. A person approves a guardrail's mode and deny patterns (ADR 0080). Instead, leave them and ask the user to approve the change, or promote a rule from audit to enforce.`
  );
}
var PROTECTED_TARGET = /(^|[/\s>'"=])\.claude\/(guardrails\.yaml|settings\.json)$/;
function checkGuardrailBash(name, args, segment) {
  const path = writtenPath(
    name,
    args,
    segment,
    (p) => PROTECTED_TARGET.test(p)
  );
  return path === void 0 ? null : warn(
    "guardrail-demotion",
    `${path.replace(/^.*(?=\.claude\/)/, "")} is rewritten by a command, whose effect on a rule's mode or deny patterns cannot be checked. Instead, edit it with the Edit tool so a weakening is checked, and leave demotions to a person (ADR 0080).`
  );
}
function checkDenyRemovalBash(name, args) {
  const words2 = [name, ...args];
  const at = words2.indexOf("guardrail");
  return words2[at + 1] === "deny" && words2.includes("--allow-removal") ? warn(
    "guardrail-demotion",
    "guardrail deny --allow-removal removes deny patterns from .claude/settings.json. A person approves a guardrail's deny patterns (ADR 0080). Instead, run it without --allow-removal, or ask the user to approve the removal first."
  ) : null;
}
var SETTINGS_PATH2 = ".claude/settings.json";
var denyOf = (source) => {
  try {
    const deny2 = JSON.parse(source).permissions?.deny;
    return Array.isArray(deny2) ? deny2 : [];
  } catch {
    return void 0;
  }
};
function checkSettingsDenyRemoval(relative3, previous, after, ctx) {
  if (relative3 !== SETTINGS_PATH2) {
    return null;
  }
  const was = denyOf(previous);
  const now = denyOf(after);
  const known = new Set(ctx.denyRules.flatMap((r) => [...r.patterns]));
  const kept = permissions(after);
  const removed = was !== void 0 && now !== void 0 ? was.filter((p) => !now.includes(p)) : permissions(previous).filter((p) => known.has(p) && !kept.includes(p));
  return removed.length === 0 ? null : warn(
    "guardrail-demotion",
    `${relative3} removes or narrows the deny patterns ${removed.join(", ")} by hand. The inventory owns the deny list and a person approves removing a pattern (ADR 0080). Instead, leave them, and ask the user to approve the change in the inventory, then run \`guardrail deny --write\`.`
  );
}

// src/hook/guard-deny.ts
function checkDenyAudit(tool, subject, ctx) {
  return ctx.denyRules.filter((r) => r.mode === "audit").flatMap((r) => {
    const pattern = r.patterns.find((p) => denyMatches(p, tool, subject));
    return pattern === void 0 ? [] : [
      warn(
        r.rule,
        `${subject} matches the deny pattern ${pattern}, which is in audit mode, so this call is allowed with a warning. Instead, avoid it unless the user asked for it; a person promotes the rule to enforce once the audit shows it is safe.`
      )
    ];
  });
}

// src/hook/guard-shell.ts
import { basename } from "node:path";
var OPERATORS = /* @__PURE__ */ new Set([";", "&&", "||", "|", "&", "\n"]);
var Splitter = class {
  constructor(command) {
    this.command = command;
  }
  command;
  segments = [];
  tokens = [];
  word = "";
  inWord = false;
  quote = null;
  run() {
    for (let i = 0; i < this.command.length; i++) {
      i = this.step(i);
    }
    this.endSegment();
    return this.segments;
  }
  endWord() {
    if (this.inWord) {
      this.tokens.push(this.word);
    }
    this.word = "";
    this.inWord = false;
  }
  endSegment() {
    this.endWord();
    if (this.tokens.length > 0) {
      this.segments.push(this.tokens);
    }
    this.tokens = [];
  }
  append(char) {
    this.word += char;
    this.inWord = true;
  }
  /** Handles the character at `i`; returns the index of the last one consumed. */
  step(i) {
    const char = this.command[i];
    const next = this.command[i + 1];
    if (this.quote) {
      return this.quoted(i, char);
    }
    if (char === "'" || char === '"') {
      this.quote = char;
      this.inWord = true;
    } else if (char === "\\" && next !== void 0) {
      this.append(next);
      return i + 1;
    } else if (char === " " || char === "	") {
      this.endWord();
    } else if (char === "\n" || char === ";") {
      this.endSegment();
    } else if ((char === "&" || char === "|") && next === char) {
      this.endSegment();
      return i + 1;
    } else if (this.isSingleOperator(i, char)) {
      this.endSegment();
    } else {
      this.append(char);
    }
    return i;
  }
  isSingleOperator(i, char) {
    return char === "|" || char === "&" && this.command[i + 1] !== ">" && this.command[i - 1] !== ">";
  }
  quoted(i, char) {
    if (char === this.quote) {
      this.quote = null;
    } else if (char === "\\" && this.quote === '"' && i + 1 < this.command.length) {
      this.word += this.command[i + 1];
      return i + 1;
    } else {
      this.word += char;
    }
    return i;
  }
};
function splitSegments(command) {
  return new Splitter(command).run().filter(
    (segment) => !(segment.length === 1 && OPERATORS.has(segment[0]))
  );
}
var WRAPPERS = /* @__PURE__ */ new Set(["sudo", "env", "time", "command", "nohup", "exec"]);
function commandOf(tokens) {
  let index = 0;
  while (index < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]) || WRAPPERS.has(tokens[index]))) {
    index++;
  }
  if (index >= tokens.length) {
    return { name: "", args: [] };
  }
  return {
    name: basename(tokens[index]),
    args: tokens.slice(index + 1)
  };
}
var isKore = (name, args) => name === "kore" || name === "npm" && args.includes("kore") || name === "node" && args.some((arg) => arg.endsWith("cli/cli.js"));
var hasFlag = (args, flag) => args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
var firstPositional = (args) => args.find((arg) => !arg.startsWith("-"));
function shellText(command) {
  const start = command.indexOf("<<");
  if (start < 0) {
    return command;
  }
  const newline = command.indexOf("\n", start);
  return newline < 0 ? command : command.slice(0, newline);
}
var WORD_BREAK = /* @__PURE__ */ new Set([
  " ",
  "	",
  "\n",
  ";",
  "&",
  "|",
  "(",
  ")",
  "<",
  ">"
]);
var SPECIAL_PARAMETER = /^[?*#@!$0-9-]$/;
var WordScanner = class {
  constructor(command) {
    this.command = command;
  }
  command;
  words = [];
  word = null;
  quote = null;
  run() {
    for (let i = 0; i < this.command.length; i++) {
      i = this.step(i);
    }
    this.end();
    return this.words;
  }
  start() {
    return this.word ??= { text: "", glob: false, equals: false };
  }
  end() {
    if (this.word) {
      this.words.push(this.word);
    }
    this.word = null;
  }
  /** Handles the character at `i`; returns the index of the last one consumed. */
  step(i) {
    const char = this.command[i];
    const next = this.command[i + 1];
    if (this.quote) {
      return this.inQuote(i, char);
    }
    if (char === "'" || char === '"') {
      this.start();
      this.quote = char;
    } else if (char === "\\") {
      this.start().text += next ?? "";
      return i + 1;
    } else if (WORD_BREAK.has(char)) {
      this.end();
    } else if (char === "$" && SPECIAL_PARAMETER.test(next ?? "")) {
      this.start().text += char + (next ?? "");
      return i + 1;
    } else {
      this.plain(char, next);
    }
    return i;
  }
  inQuote(i, char) {
    if (char === this.quote) {
      this.quote = null;
    } else if (char === "\\" && this.quote === '"') {
      this.start().text += this.command[i + 1] ?? "";
      return i + 1;
    } else {
      this.start().text += char;
    }
    return i;
  }
  plain(char, next) {
    const current = this.start();
    if (char === "*" || char === "?") {
      current.glob = true;
    }
    if (char === "=" && current.text === "" && /[^\s]/.test(next ?? " ")) {
      current.equals = true;
    }
    current.text += char;
  }
};
function rawWords(command) {
  return new WordScanner(command).run();
}

// src/hook/guard-commands.ts
var KUBECTL_OFFLINE = /* @__PURE__ */ new Set([
  "config",
  "completion",
  "help",
  "kustomize",
  "plugin"
]);
var HELM_CLUSTER = /* @__PURE__ */ new Set([
  "install",
  "upgrade",
  "uninstall",
  "list",
  "ls",
  "status",
  "rollback",
  "get",
  "test",
  "history"
]);
function checkContext(name, args) {
  if (name === "kubectl") {
    const sub = firstPositional(args);
    const offline = !sub || KUBECTL_OFFLINE.has(sub) || sub === "version" && args.includes("--client");
    if (!offline && !hasFlag(args, "--context")) {
      return block(
        "kubectl-context",
        "kubectl ran without --context, so it would target whatever context is current. Instead, pass --context with the environment's configured context (for example --context kore-local)."
      );
    }
  }
  if (name === "helm") {
    const sub = firstPositional(args);
    if (sub && HELM_CLUSTER.has(sub) && !hasFlag(args, "--kube-context")) {
      return block(
        "helm-context",
        "helm ran without --kube-context, so it would target whatever context is current. Instead, pass --kube-context with the environment's configured context."
      );
    }
  }
  return null;
}
var destructive = () => block(
  "destructive",
  "Destructive operations need a human's explicit consent. Instead, ask the user to run the command themselves (for example with `! <command>`), or use a non-destructive alternative."
);
function deletesK3dCluster(args) {
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const clusterAt = positional.indexOf("cluster");
  return clusterAt >= 0 && positional.indexOf("delete", clusterAt) >= 0;
}
function deletesNamespace(args) {
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const deleteAt = positional.indexOf("delete");
  return deleteAt >= 0 && ["namespace", "namespaces", "ns"].includes(positional[deleteAt + 1] ?? "");
}
function isDestructive(name, args) {
  switch (name) {
    case "minikube":
      return firstPositional(args) === "delete";
    case "k3d":
      return deletesK3dCluster(args);
    case "tofu":
    case "terraform":
      return args.includes("destroy");
    case "helm":
      return firstPositional(args) === "uninstall";
    case "kubectl":
      return deletesNamespace(args);
    default:
      return isKore(name, args) && args.includes("destroy");
  }
}
function checkDestructive(name, args) {
  return isDestructive(name, args) ? destructive() : null;
}
function checkNoVerify(name, args) {
  if (name !== "git") {
    return null;
  }
  const commitAt = args.indexOf("commit");
  if (commitAt < 0) {
    return null;
  }
  const skips = args.slice(commitAt + 1).some((arg) => arg === "--no-verify" || /^-[A-Za-z]*n[A-Za-z]*$/.test(arg));
  if (!skips) {
    return null;
  }
  return block(
    "no-verify",
    "Skipping commit hooks bypasses formatting, lint, and commit-message checks. Instead, fix what the hook reports and commit again without --no-verify."
  );
}
var BODY_FLAGS = ["--body", "--body-file", "-b", "-F", "--title", "-t"];
function checkIdeaIssueBody(name, args) {
  if (name !== "gh" || args[0] !== "issue" || args[1] !== "edit") {
    return null;
  }
  if (!BODY_FLAGS.some((flag) => hasFlag(args, flag))) {
    return null;
  }
  return warn(
    "idea-issue-body",
    "Issue titles and bodies for ideas are rendered from docs/ideas and overwritten by the next sync. Instead, edit the idea's markdown and run `harness idea sync --idea <number or slug>`; use labels, assignees and comments for anything workflow-related."
  );
}
var OUTCOME_LABEL = /(^|,)outcome:/;
function labelValues(args, flag) {
  return args.flatMap((arg, i) => {
    if (arg.startsWith(`${flag}=`)) {
      return [arg.slice(flag.length + 1)];
    }
    const value = args[i + 1];
    return arg === flag && value !== void 0 ? [value] : [];
  });
}
function checkIdeaIssueClose(name, args) {
  if (name !== "gh" || args[0] !== "issue") {
    return null;
  }
  const closing = args[1] === "close";
  const labelling = args[1] === "edit" && ["--add-label", "-l"].some(
    (flag) => labelValues(args, flag).some((v) => OUTCOME_LABEL.test(v))
  );
  if (!closing && !labelling) {
    return null;
  }
  return warn(
    "idea-issue-close",
    "An idea's issue closes, and takes its outcome:* label, only through the outcome tool, which refuses to close without a recorded outcome. Instead, run `harness outcome record` to record the outcome, or `harness outcome close --idea <number or slug>` to finish closing one already recorded."
  );
}

// src/hook/guard-secrets.ts
var SECRET_PATH = /(^|[/\s>'"=])\.kore\/(keys\/|state\/[^/\s'"]*token)/;
var SECRET_SAFE = /* @__PURE__ */ new Set(["ls", "stat", "test", "["]);
var secretBlock = () => block(
  "secret-path",
  "Key and token material under .kore/ must not be read or written directly. Instead, use a kore command that streams the secret through stdin, or ask the user to handle it."
);
async function loadSopsPatterns(ctx) {
  let text9;
  try {
    text9 = await ctx.readFile(`${ctx.root}/.sops.yaml`);
  } catch {
    return [];
  }
  const patterns = [];
  for (const match of text9.matchAll(/path_regex:\s*(.+)$/gm)) {
    const source = match[1].trim().replace(/^['"]|['"]$/g, "");
    try {
      patterns.push(new RegExp(source));
    } catch {
    }
  }
  return patterns;
}
var sopsBlock = (path) => block(
  "sops-plaintext",
  `${path} is an encrypted secret path; plaintext must never be written to it. Instead, edit it with \`sops <path>\` or encrypt through \`sops --encrypt\`.`
);

// src/hook/guard-bash.ts
async function sopsWrite(name, segment, text9, ctx) {
  const writes2 = text9.includes(">") || ["tee", "cp", "mv", "sed"].includes(name);
  if (name === "sops" || !writes2) {
    return null;
  }
  const patterns = await loadSopsPatterns(ctx);
  const target = segment.find((token) => {
    const path = token.replace(/^>+/, "");
    return patterns.some((pattern) => pattern.test(path));
  });
  return target ? sopsBlock(target.replace(/^>+/, "")) : null;
}
async function checkBashSegment(segment, ctx) {
  const { name, args } = commandOf(segment);
  if (!name) {
    return [];
  }
  const text9 = segment.join(" ");
  if (!SECRET_SAFE.has(name) && !isKore(name, args) && SECRET_PATH.test(text9)) {
    return [secretBlock()];
  }
  return [
    await sopsWrite(name, segment, text9, ctx),
    checkDestructive(name, args),
    checkContext(name, args),
    checkNoVerify(name, args),
    checkIdeaIssueBody(name, args),
    checkIdeaIssueClose(name, args),
    checkAppendOnly(name, args, segment, ctx.root),
    checkGuardrailBash(name, args, segment),
    checkDenyRemovalBash(name, args),
    ...checkDenyAudit("Bash", text9, ctx)
  ];
}
var UNQUOTED_GLOB = /(?:^|\s)--(include|exclude)=([^\s'"]*\*[^\s'"]*)/;
function unquotedGlob(command) {
  const match = UNQUOTED_GLOB.exec(shellText(command));
  if (!match) {
    return null;
  }
  return block(
    "unquoted-glob",
    `--${match[1]}=${match[2]} is unquoted; zsh fails the whole command when the glob matches no file. Instead, quote it: --${match[1]}='${match[2]}'.`
  );
}
function zshWords(command) {
  const text9 = shellText(command).replace(/\$?\(\([^)]*\)\)/g, "");
  const words2 = rawWords(text9);
  const glob = words2.find((w) => w.glob && !w.text.includes("${"));
  const equals = text9.includes("[[") ? void 0 : words2.find((w) => w.equals);
  return [
    glob ? warn(
      "bare-glob",
      `${glob.text} is an unquoted glob; zsh fails the whole command with "no matches found" when it matches no file. Instead, quote it ('${glob.text}') unless it must expand, and check that it matches.`
    ) : null,
    equals ? warn(
      "equals-word",
      `${equals.text} starts with an unquoted =, which zsh expands as a command lookup ("${equals.text.slice(1)} not found"). Instead, quote it: '${equals.text}'.`
    ) : null
  ];
}
async function evaluateBash(command, ctx) {
  const found = [unquotedGlob(command)];
  for (const segment of splitSegments(command)) {
    found.push(...await checkBashSegment(segment, ctx));
  }
  found.push(...zshWords(command));
  return weigh(found.map((finding2) => applyMode(finding2, ctx)));
}

// src/hook/guard-file.ts
var text7 = (value) => typeof value === "string" ? value : "";
var written = (tool, input) => text7(tool === "Edit" ? input["new_string"] : input["content"]);
async function before(tool, input, relative3, ctx, rethrow) {
  if (tool === "Edit") {
    return text7(input["old_string"]);
  }
  try {
    return await ctx.readFile(`${ctx.root}/${relative3}`);
  } catch (error) {
    if (rethrow && error?.code !== "ENOENT") {
      throw error;
    }
    return "";
  }
}
var GUARDED_FILES = [INVENTORY_PATH, ".claude/settings.json"];
async function guardedChange(tool, input, relative3, ctx) {
  if (!GUARDED_FILES.includes(relative3)) {
    return { previous: "", after: "" };
  }
  if (tool !== "Edit") {
    return {
      previous: await before(tool, input, relative3, ctx, false),
      after: written(tool, input)
    };
  }
  const old = text7(input["old_string"]);
  const replacement = text7(input["new_string"]);
  const disk = await before("Write", input, relative3, ctx, false);
  const at = old === "" ? -1 : disk.indexOf(old);
  if (at < 0) {
    return { previous: old, after: replacement };
  }
  const after = input["replace_all"] === true ? disk.split(old).join(replacement) : disk.slice(0, at) + replacement + disk.slice(at + old.length);
  return { previous: disk, after };
}
var THRESHOLD = /\b(statements|branches|functions|lines)\s*:\s*(\d+(?:\.\d+)?)/g;
function thresholds(source) {
  return new Map(
    [...source.matchAll(THRESHOLD)].map((match) => [
      match[1],
      Number(match[2])
    ])
  );
}
function lowersThresholds(previous, after) {
  const old = thresholds(previous);
  for (const [key, value] of thresholds(after)) {
    const was = old.get(key);
    if (was !== void 0 && value < was) {
      return true;
    }
  }
  return false;
}
var IMAGE_LINE = /^\s*-?\s*image:\s*["']?([^\s"'#]+)/gm;
var OVERLAY_PATH = /^infra\/environments\/[^/]+\/environment\.yaml$/;
var FEATURES_BLOCK = /["']?features["']?\s*:\s*\{[^}]*\}/s;
var FLAG_ON = /["']?([a-z][a-z0-9-]*)["']?\s*:\s*true\b/g;
var FLAG_OFF = /["']?([a-z][a-z0-9-]*)["']?\s*:\s*false\b/g;
var flagsIn = (source, pattern) => new Set([...source.matchAll(pattern)].map((m) => m[1]));
function flagsOn(source, previous) {
  const features = FEATURES_BLOCK.exec(source)?.[0];
  if (features !== void 0) {
    return flagsIn(features, FLAG_ON);
  }
  const off = flagsIn(previous, FLAG_OFF);
  return new Set([...flagsIn(source, FLAG_ON)].filter((name) => off.has(name)));
}
async function checkFlagOn(tool, input, relative3, ctx) {
  if (!OVERLAY_PATH.test(relative3)) {
    return null;
  }
  const previous = await before(tool, input, relative3, ctx, true);
  const after = written(tool, input);
  const already = flagsIn(FEATURES_BLOCK.exec(previous)?.[0] ?? "", FLAG_ON);
  const added = [...flagsOn(after, previous)].filter(
    (name) => !already.has(name)
  );
  if (tool === "Write" && !FEATURES_BLOCK.test(after)) {
    return null;
  }
  if (added.length === 0) {
    return null;
  }
  return warn(
    "flag-activation",
    `${relative3} turns on flag ${added[0]} by hand. A flag turns on only with a recorded live proof. Instead, record a confirmed live-run verification outcome (\`harness outcome record --kind verification --source live-run --flag <name> --environment <env> ...\`), then run \`harness flag activate <flag> --environment <env>\`.`
  );
}
function checkImageDigest(tool, input, relative3) {
  if (!relative3.startsWith("apps/") && !relative3.startsWith("infra/environments/")) {
    return null;
  }
  const tagged = [...written(tool, input).matchAll(IMAGE_LINE)].filter(
    (m) => !m[1].includes("@sha256:")
  );
  if (tagged.length === 0) {
    return null;
  }
  return warn(
    "image-digest",
    `${tagged[0][1]} is not pinned by digest. Images are deployed by signed digest, never by tag. Instead, reference it as name@sha256:<digest> from the release lock.`
  );
}
var IDEA_PATH = /^docs\/ideas\/[^/]+\.md$/;
var HAND_WRITTEN_OUTCOME = /^(?:#{1,6}[ \t]+outcome\b|outcome:)/im;
var ideaOutcomeWarn = (path) => warn(
  "idea-outcome",
  `${path} is an idea record: its outcome is written by the outcome tool, never by hand. Instead, run \`harness outcome record --idea <number or slug> --kind <experiment|usage|verification> --source <live-run|journal|eval-history|comparison> --evidence <reference> --result <confirmed|refuted|inconclusive> --summary <text>\`.`
);
async function checkCoverageThreshold(tool, input, relative3, ctx) {
  if (relative3 !== "tools/kore/vitest.config.ts") {
    return null;
  }
  const previous = await before(tool, input, relative3, ctx, false);
  if (!lowersThresholds(previous, written(tool, input))) {
    return null;
  }
  return block(
    "coverage-threshold",
    "Coverage thresholds only go up. Instead, add tests for the uncovered code and leave the thresholds unchanged."
  );
}
async function checkSopsPath(tool, input, relative3, ctx) {
  const patterns = await loadSopsPatterns(ctx);
  if (!patterns.some((pattern) => pattern.test(relative3))) {
    return null;
  }
  const encrypted = tool === "Write" && /^sops:/m.test(text7(input["content"]));
  return encrypted ? null : sopsBlock(relative3);
}
async function checkWrite(tool, input, relative3, ctx) {
  if (isAppendOnly(relative3)) {
    return applyMode(appendOnlyWarn(relative3), ctx) ?? allow;
  }
  const ideaOutcome = IDEA_PATH.test(relative3) && HAND_WRITTEN_OUTCOME.test(written(tool, input)) ? ideaOutcomeWarn(relative3) : null;
  const guarded4 = await guardedChange(tool, input, relative3, ctx);
  const findings2 = [
    await checkFlagOn(tool, input, relative3, ctx),
    ideaOutcome,
    await checkSopsPath(tool, input, relative3, ctx),
    await checkCoverageThreshold(tool, input, relative3, ctx),
    checkImageDigest(tool, input, relative3),
    checkGuardrailDemotion(relative3, guarded4.previous, guarded4.after),
    checkSettingsDenyRemoval(relative3, guarded4.previous, guarded4.after, ctx)
  ];
  return weigh(findings2.map((finding2) => applyMode(finding2, ctx)));
}
async function fileRules(tool, input, relative3, ctx) {
  if (SECRET_PATH.test(relative3)) {
    return applyMode(secretBlock(), ctx);
  }
  if (tool === "Read") {
    return allow;
  }
  return await checkWrite(tool, input, relative3, ctx);
}
async function evaluateFile(tool, input, relative3, ctx) {
  const verdict = await fileRules(tool, input, relative3, ctx);
  const audited = checkDenyAudit(tool, relative3, ctx);
  if (verdict.action === "block" || audited.length === 0) {
    return verdict;
  }
  const extra = weigh(audited);
  if (verdict.action !== "warn" || extra.action !== "warn") {
    return extra;
  }
  return {
    ...verdict,
    message: `${verdict.message}
${extra.message}`,
    rules: [...verdict.rules ?? [verdict.rule], ...extra.rules ?? []]
  };
}

// src/hook/guard-role.ts
import { isAbsolute as isAbsolute2, relative as relative2, resolve as resolve5 } from "node:path";

// src/hook/guard-role-delivery.ts
import { isAbsolute, relative, resolve as resolve4 } from "node:path";

// src/hook/guard-role-writes.ts
var WRITE_TOOLS = /* @__PURE__ */ new Set(["Write", "Edit", "NotebookEdit"]);
var WRITERS = /* @__PURE__ */ new Set([
  "tee",
  "cp",
  "mv",
  "rm",
  "rmdir",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "ln",
  "truncate",
  "dd",
  "install"
]);
var WRITING_GIT = /* @__PURE__ */ new Set([
  "add",
  "commit",
  "push",
  "apply",
  "am",
  "checkout",
  "switch",
  "restore",
  "reset",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "stash",
  "clean",
  "rm",
  "mv",
  "worktree",
  "tag",
  "branch"
]);
var WRITING_GH = /* @__PURE__ */ new Set(["merge", "close", "edit", "checkout"]);
var readOnly = (what) => block(
  "role-read-only",
  `${what} changes files, and the concierge, reader, refiner, challenger, orchestrator and judge never write. Instead, report what needs changing: the concierge files it as an idea, the reader returns it in its summary, the orchestrator hands it to a writer, the judge sends the change back, the refiner files an idea with \`idea new\` and the challenger records a round with \`idea challenge\`.`
);
var FD_OPERATOR = /^(?:\d*>>?|&>>?)$/;
var harmless = (target) => target === "/dev/null" || target === "&1" || target === "&2";
var redirectsToFile = (segment) => segment.some((word, index) => {
  if (FD_OPERATOR.test(word)) {
    return !harmless(segment[index + 1]);
  }
  const joined = /^(?:\d*>>?|&>>?)(.+)$/.exec(word);
  return joined !== null && !harmless(joined[1]);
});
function writes(segment) {
  const { name, args } = commandOf(segment);
  const verb = args.find((arg) => !arg.startsWith("-"));
  return redirectsToFile(segment) || WRITERS.has(name) || name === "sed" && args.some((arg) => /^-\w*i/.test(arg)) || name === "git" && verb !== void 0 && WRITING_GIT.has(verb) || name === "gh" && args[0] === "pr" && args[1] !== void 0 && WRITING_GH.has(args[1]);
}
var HARNESS2 = /^(\.\/)?skills\/bin\/harness\.mjs$/;
var namesLedger = (args) => args.some((arg) => arg === "--ledger" || arg.startsWith("--ledger="));
var harnessAllowed = (name, args, allowed) => name === "node" && HARNESS2.test(args[0] ?? "") && !namesLedger(args) && allowed.includes(`${args[1] ?? ""} ${args[2] ?? ""}`);
var harnessStatus = (name, args) => name === "node" && HARNESS2.test(args[0] ?? "") && args[1] === "status" && args.length <= 3 && (args[2] === void 0 || args[2] === "--json");

// src/hook/guard-role-delivery.ts
var REPORTING_ROLES = /* @__PURE__ */ new Set(["orchestrator", "judge"]);
var DELIVERY_ROLES = /* @__PURE__ */ new Set([...REPORTING_ROLES, "writer"]);
var noMerge = (role, what) => block(
  "role-no-merge",
  `${what} merges, but the ${role} may not: the merge tool does not exist yet (plan 11 Step 5), so no role merges. Instead, report the verdict; the judge reports safe or sends the change back, and the operator merges.`
);
var outsideWorktree = (what, root3) => block(
  "role-worktree",
  `${what} reaches outside this worktree (${root3}), and a writer works only in the worktree it was launched in. Instead, make the change inside the worktree, or report that it needs another piece of work.`
);
var MERGE_API = /\/pulls\/\d+\/merge\b/;
var merges = (segment) => {
  const { name, args } = commandOf(segment);
  return name === "gh" && (args[0] === "pr" && args[1] === "merge" || args[0] === "api" && args.some((arg) => MERGE_API.test(arg)));
};
function runsInline(segment) {
  const { name, args } = commandOf(segment);
  return name === "node" && args.some((a) => ["-e", "--eval", "-p"].includes(a)) || /^python3?$/.test(name) && args.includes("-c") || name === "perl" && args.some((a) => /^-\w*[eEip]/.test(a)) || name === "ruby" && args.includes("-e") || /^g?awk$/.test(name) && args.some((a) => a === "inplace" || a === "--in-place");
}
var READS = [
  "plan active",
  "idea list",
  "idea show",
  "flow report",
  "ledger list",
  "guardrail status",
  "flag audit",
  "skill audit",
  "session tier"
];
var ORCHESTRATOR_HARNESS = [
  ...READS,
  "session spawn",
  "session wait",
  "session close",
  "session equalize",
  "idea sync",
  "outcome record",
  "outcome close"
];
var harnessFor = (role) => role === "orchestrator" ? ORCHESTRATOR_HARNESS : READS;
function harnessRefused(role, segment) {
  const { name, args } = commandOf(segment);
  if (name !== "node" || !(args[0] ?? "").endsWith("harness.mjs")) {
    return false;
  }
  return !(HARNESS2.test(args[0] ?? "") && harnessAllowed(name, args, harnessFor(role)));
}
var SCRATCH = ["/tmp/", "/private/tmp/", "/var/folders/", "/dev/"];
var PATHS = /(?:~|\.\.|\/)[\w.@~/-]*/g;
function outside(root3, path) {
  if (path.startsWith("~")) {
    return true;
  }
  const full = resolve4(root3, path);
  const from = relative(root3, full);
  const within = from === "" || !from.startsWith("..") && !isAbsolute(from);
  return !within && !SCRATCH.some((dir) => full.startsWith(dir) || `${full}/` === dir);
}
function escapes(segment, root3) {
  const { name, args } = commandOf(segment);
  const target = name === "git" ? args[args.indexOf("-C") + 1] : args[0];
  if ((name === "cd" || name === "git" && args.includes("-C")) && target !== void 0 && outside(root3, target)) {
    return target;
  }
  if (!writes(segment) && !runsInline(segment)) {
    return void 0;
  }
  return segment.flatMap((word) => word.replace(/^(?:\d*>>?|&>>?)/, "").match(PATHS) ?? []).find((path) => outside(root3, path));
}
function checkDeliveryBash(role, command, root3) {
  const segments = splitSegments(command);
  const merging = segments.find(merges);
  if (merging !== void 0) {
    return noMerge(role, `\`${merging.join(" ")}\``);
  }
  if (REPORTING_ROLES.has(role)) {
    const changing = segments.find(
      (s) => writes(s) || runsInline(s) || harnessRefused(role, s)
    );
    return changing === void 0 ? null : readOnly(`\`${changing.join(" ")}\``);
  }
  for (const segment of segments) {
    const path = escapes(segment, root3);
    if (path !== void 0) {
      return outsideWorktree(`\`${segment.join(" ")}\``, root3);
    }
  }
  return null;
}
function checkDelivery(role, tool, input, root3) {
  if (tool === "Bash" && typeof input["command"] === "string") {
    return checkDeliveryBash(role, input["command"], root3);
  }
  if (!WRITE_TOOLS.has(tool)) {
    return null;
  }
  if (REPORTING_ROLES.has(role)) {
    return readOnly(tool);
  }
  const path = input["file_path"] ?? input["notebook_path"];
  return typeof path === "string" && outside(root3, path) ? outsideWorktree(tool, root3) : null;
}

// src/hook/guard-role.ts
var READ_ONLY_ROLES = /* @__PURE__ */ new Set([
  "concierge",
  "reader",
  "refiner",
  "challenger"
]);
var NO_CODE_ROLES = /* @__PURE__ */ new Set(["concierge", "challenger"]);
var FILE_TOOLS = /* @__PURE__ */ new Set(["Read", "Grep", "Glob"]);
var CONCIERGE_PATHS = /^(infra\/plans\/|docs\/|GLOSSARY\.md$|README\.md$)/;
function insideRoot(root3, path) {
  const from = relative2(root3, resolve5(root3, path));
  return from.startsWith("..") || isAbsolute2(from) ? void 0 : from;
}
function readable(root3, input) {
  const path = input["file_path"] ?? input["path"];
  const pattern = input["pattern"];
  const glob = input["glob"];
  const climbs = [pattern, glob].some(
    (value) => typeof value === "string" && (value.split("/").includes("..") || value.startsWith("/"))
  );
  const inside = typeof path === "string" ? insideRoot(root3, path) : void 0;
  return !climbs && inside !== void 0 && CONCIERGE_PATHS.test(inside);
}
var noCode = (what, role) => block(
  "role-no-code",
  `${what} reads code, and the ${role} works from plans, ADRs, ideas, issues and the ledger. Instead, ask a reader to look at the code and summarize it.`
);
var PR_READS = ["view", "list", "status", "checks"];
var ISSUE_READS = ["view", "list", "status"];
var HARNESS_READS = [
  "plan active",
  "idea list",
  "idea show",
  "flow report",
  "ledger list"
];
var CONCIERGE_HARNESS = [...HARNESS_READS, "idea new", "idea sync"];
var REFINER_HARNESS = [...HARNESS_READS, "idea new", "idea sync"];
var CHALLENGER_HARNESS = [...HARNESS_READS, "idea challenge"];
var READ_UTILITIES = /* @__PURE__ */ new Set([
  "cat",
  "head",
  "tail",
  "ls",
  "grep",
  "rg",
  "wc",
  "sort",
  "diff",
  "stat",
  "file",
  "tree",
  "basename",
  "dirname",
  "jq",
  "date",
  "echo",
  "pwd"
]);
var hasShortO = (args) => args.some((arg) => /^-[a-zA-Z]*o/.test(arg));
function utilityMayRun(name, args) {
  switch (name) {
    case "sort":
      return !(hasShortO(args) || args.some(
        (arg) => arg.startsWith("--output") || arg.startsWith("--compress-program")
      ));
    case "tree":
      return !hasShortO(args);
    case "rg":
      return !args.some((arg) => arg === "--pre" || arg.startsWith("--pre="));
    case "file":
      return !args.some(
        (arg) => /^-[a-zA-Z]*C/.test(arg) || arg === "--compile"
      );
    default:
      return true;
  }
}
var gitWrites = (args) => args.some(
  (arg) => arg.startsWith("--output") || arg.startsWith("--open-files-in-pager") || arg.startsWith("--ext-diff") || arg.startsWith("--textconv") || arg.startsWith("--config-env") || arg.startsWith("-O")
);
var CONCIERGE_GIT_FLAGS = {
  log: /^(--|--oneline|--graph|--decorate|--no-decorate|--all|--no-merges|--merges|--first-parent|--abbrev-commit|--since=.+|--until=.+|--author=.+|--grep=.+|--format=.+|--pretty=.+|--date=.+|--max-count=.+|-n|-\d+)$/,
  status: /^(-s|--short|-b|--branch|--porcelain|--porcelain=.+|--long)$/
};
function conciergeGit(args) {
  const [verb = "", ...rest] = args;
  const flags = CONCIERGE_GIT_FLAGS[verb];
  return flags !== void 0 && rest.every((arg) => !arg.startsWith("-") || flags.test(arg));
}
function ghMayRun(args, patches) {
  const [group, verb] = args;
  return group === "issue" && ISSUE_READS.includes(verb ?? "") || group === "label" && verb === "list" || group === "pr" && PR_READS.includes(verb ?? "") || patches && group === "pr" && verb === "diff";
}
function noCodeMayRun(role, segment) {
  const { name, args } = commandOf(segment);
  return harnessAllowed(
    name,
    args,
    role === "challenger" ? CHALLENGER_HARNESS : CONCIERGE_HARNESS
  ) || harnessStatus(name, args) || name === "gh" && ghMayRun(args, false) || name === "git" && conciergeGit(args) || ["date", "echo", "pwd"].includes(name);
}
var READER_GIT = [
  "log",
  "status",
  "show",
  "diff",
  "blame",
  "ls-files",
  "grep",
  "rev-parse"
];
function readerMayRun(role, segment) {
  const { name, args } = commandOf(segment);
  if (name === "find") {
    return !args.some(
      (arg) => [
        "-delete",
        "-exec",
        "-execdir",
        "-ok",
        "-okdir",
        "-fprint",
        "-fprint0",
        "-fprintf",
        "-fls"
      ].includes(arg)
    );
  }
  if (name === "git") {
    return READER_GIT.includes(args.find((arg) => !arg.startsWith("-")) ?? "") && !gitWrites(args);
  }
  return harnessAllowed(
    name,
    args,
    role === "refiner" ? REFINER_HARNESS : HARNESS_READS
  ) || name === "gh" && ghMayRun(args, true) || READ_UTILITIES.has(name) && utilityMayRun(name, args);
}
var PREFIXED = /^(?:[A-Za-z_][A-Za-z0-9_]*=|(?:sudo|env|time|command|nohup|exec)$)/;
function checkBash(role, command) {
  if (/\$\(|`|<\(|>\(/.test(command)) {
    return NO_CODE_ROLES.has(role) ? noCode("A command substitution", role) : readOnly("A command substitution");
  }
  const segments = splitSegments(command);
  const prefixed = segments.find((segment) => PREFIXED.test(segment[0] ?? ""));
  if (prefixed !== void 0) {
    const what = `\`${prefixed.join(" ")}\`, which sets an environment variable,`;
    return NO_CODE_ROLES.has(role) ? noCode(what, role) : readOnly(what);
  }
  const writer = segments.find(writes);
  if (writer !== void 0) {
    return readOnly(`\`${writer.join(" ")}\``);
  }
  if (NO_CODE_ROLES.has(role)) {
    const stray = segments.find((segment) => !noCodeMayRun(role, segment));
    return stray === void 0 ? null : noCode(`\`${stray.join(" ")}\``, role);
  }
  const unknown = segments.find((segment) => !readerMayRun(role, segment));
  return unknown === void 0 ? null : readOnly(
    `\`${unknown.join(" ")}\`, which is not a known read-only command,`
  );
}
function checkRole(agentType, tool, input, root3) {
  if (typeof agentType === "string" && DELIVERY_ROLES.has(agentType)) {
    return checkDelivery(agentType, tool, input, root3);
  }
  if (typeof agentType !== "string" || !READ_ONLY_ROLES.has(agentType)) {
    return null;
  }
  if (WRITE_TOOLS.has(tool)) {
    return readOnly(`${tool}`);
  }
  if (tool === "Bash" && typeof input["command"] === "string") {
    return checkBash(agentType, input["command"]);
  }
  if (NO_CODE_ROLES.has(agentType) && FILE_TOOLS.has(tool)) {
    return readable(root3, input) ? null : noCode(tool, agentType);
  }
  return null;
}

// src/hook/guard-evaluate.ts
var asCall2 = (payload) => typeof payload === "object" && payload !== null ? payload : {};
async function evaluate(payload, ctx) {
  const call = asCall2(payload);
  const tool = call.tool_name;
  const input = call.tool_input ?? {};
  const bounded = typeof tool === "string" ? checkRole(call.agent_type, tool, input, ctx.root) : null;
  if (bounded !== null) {
    return bounded;
  }
  if (tool === "Bash" && typeof input["command"] === "string") {
    return await evaluateBash(input["command"], ctx);
  }
  const filePath = input.file_path;
  if ((tool === "Read" || tool === "Write" || tool === "Edit") && typeof filePath === "string") {
    const prefix = `${ctx.root}/`;
    const relative3 = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
    return await evaluateFile(tool, input, relative3, ctx);
  }
  return allow;
}

// src/hook/guard.ts
async function guard(payload, deps) {
  if (payload === void 0) {
    return {};
  }
  const call = asCall2(payload);
  const root3 = deps.env["CLAUDE_PROJECT_DIR"] || (typeof call.cwd === "string" && call.cwd !== "" ? call.cwd : deps.cwd);
  const started = recordEvent(deps, "tool.start", call);
  const readFile2 = (path) => deps.fs.readFile(path);
  let inventory;
  let problem = "";
  try {
    inventory = await findInventory(readFile2, root3);
  } catch (error) {
    if (!(error instanceof GuardrailError)) {
      throw error;
    }
    problem = `
[guard] Every rule is enforcing because ${error.message}`;
  }
  const verdict = await evaluate(payload, {
    root: root3,
    readFile: readFile2,
    modeOf: (rule) => inventory ? modeOf(inventory, rule) : "enforce",
    denyRules: inventory ? denyRules(inventory) : []
  });
  await started;
  if (verdict.action === "block") {
    await recordEvent(deps, "tool.end", call, "failure");
    return { code: 2, stderr: `${verdict.message}${problem}
` };
  }
  if (verdict.action === "warn") {
    for (const rule of verdict.rules ?? [verdict.rule]) {
      await recordEvent(deps, "guard.audit", call, void 0, { label: rule });
    }
    return {
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: verdict.message
        }
      })
    };
  }
  return {};
}

// src/hook/io.ts
async function readPayload(deps) {
  const text9 = await deps.stdin();
  if (text9.trim() === "") {
    return void 0;
  }
  try {
    return JSON.parse(text9);
  } catch {
    return void 0;
  }
}
function hookCommand(name, summary, handler, { flags = {}, payload = true, operand, faultCode = 0 } = {}) {
  return {
    summary,
    options: { ...flags, strict: "boolean" },
    ...operand === void 0 ? {} : { operand },
    async run({ deps, options, operand: given }) {
      let result;
      try {
        result = await handler({
          deps,
          options,
          operand: given,
          payload: payload ? await readPayload(deps) : void 0
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const hint = error instanceof CommandError ? "" : " (unexpected; fixing it is on the harness)";
        const code = options["strict"] === true ? 1 : faultCode;
        deps.stderr(
          `[hook:${name}] ${code === 0 ? "failed open" : "failed"}: ${reason}${hint}
`
        );
        return code;
      }
      if (result.stdout) {
        deps.stdout(result.stdout);
      }
      if (result.stderr) {
        deps.stderr(result.stderr);
      }
      return result.code ?? 0;
    }
  };
}

// src/hook/retro-scan.ts
import { createHash } from "node:crypto";

// src/hook/retro-transcript.ts
var MAX_ERROR = 120;
var MIN_CORRECTION_WORDS = 4;
function parseTranscript(id, text9) {
  const events = [];
  let skipped = 0;
  text9.split("\n").forEach((raw, index) => {
    if (raw.trim() === "") {
      return;
    }
    try {
      const value = JSON.parse(raw);
      if (value === null || typeof value !== "object") {
        throw new Error("not an object");
      }
      events.push({ ...value, line: index + 1 });
    } catch {
      skipped++;
    }
  });
  return { id, events, skipped };
}
var ERROR_WORDS = /\b(errors?|fail(ed|ure|ures)?|fatal|not found|no such|denied|cannot|invalid|refused|no matches)\b/i;
var SHELL_PREFIX = /^(\(eval\):\d+:|zsh:|bash:|sh:)/;
var NOT_OUTPUT_ERROR = /^(- |#|import |export |\|)/;
var looksLikeError = (line2) => !NOT_OUTPUT_ERROR.test(line2) && (ERROR_WORDS.test(line2) || SHELL_PREFIX.test(line2));
function summarizeError(text9) {
  const lines2 = text9.replace(/<\/?tool_use_error>/g, "").split("\n").map((line2) => line2.trim()).filter(Boolean);
  let head = lines2[0] ?? "";
  let prefix = "";
  if (/^Exit code \d+$/.test(head)) {
    prefix = head;
    head = lines2.slice(1).find(looksLikeError) ?? "";
  }
  const normalized = head.replace(/'[^']*'|"[^"]*"/g, "<q>").replace(/(^|[\s(=])\/[^\s)]*/g, "$1<path>").replace(/(^|\s)\S*\*\S*/g, "$1<glob>").replace(/\b\d+\b/g, "N");
  const joined = prefix && normalized ? `${prefix}: ${normalized}` : prefix || normalized;
  return joined.slice(0, MAX_ERROR);
}
var blocksOf = (event) => Array.isArray(event.message?.content) ? event.message.content : [];
function resultText(block2) {
  const { content } = block2;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => part?.text ?? "").join("\n");
  }
  return "";
}
var callSignature = (input = {}) => JSON.stringify(
  input["command"] ?? input["new_string"] ?? input["content"] ?? input
);
var INJECTED = /^\s*<(command-|local-command|task-notification)/;
function typedText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.filter((block2) => block2.type === "text").map((block2) => block2.text).join("\n");
}
function humanText(event) {
  const notTyped = event.type !== "user" || event.isSidechain || event.isMeta || event.isCompactSummary;
  if (notTyped || event.origin && event.origin.kind !== "human") {
    return null;
  }
  const text9 = typedText(event.message?.content);
  return text9.trim() === "" || INJECTED.test(text9) ? null : text9;
}
var CORRECTION_WORD = /\b(no|not|dont|don't|don’t|stop|instead|wrong|again|actually|should|never)\b/i;
var readsAsCorrection = (text9) => CORRECTION_WORD.test(text9);
var ownWords = (text9) => text9.replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, " ").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ");
var phrasesOf = (text9) => text9.split(/[.!?;\n]+/).map(
  (part) => part.toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim()
).filter((phrase) => phrase.split(" ").length >= MIN_CORRECTION_WORDS);
function timestamps(session2) {
  const stamps = session2.events.map((event) => event.timestamp).filter((stamp) => Boolean(stamp)).sort();
  return { first: stamps[0] ?? null, last: stamps.at(-1) ?? null };
}

// src/hook/retro-session.ts
var GUARD_TAG = /\[guard:([a-z0-9-]+)\]/g;
var SLASH_COMMAND = /<command-name>\/?([a-z0-9:-]+)<\/command-name>/;
var tagsIn = (text9) => [...text9.matchAll(GUARD_TAG)].map((match) => match[1] ?? "");
var SessionAnalysis = class {
  guards = {};
  failures = [];
  skills = /* @__PURE__ */ new Set();
  slashCommands = [];
  phrases = [];
  warnings = [];
  ordered = [];
  calls = /* @__PURE__ */ new Map();
  failedSinceHuman = false;
  constructor(session2) {
    for (const event of session2.events) {
      for (const block2 of blocksOf(event)) {
        this.block(event, block2);
      }
      this.attachment(event);
      this.human(event);
      this.slash(event);
    }
  }
  bump(rule, key) {
    const counts = this.guards[rule] ??= { blocks: 0, warnings: 0 };
    counts[key]++;
  }
  block(event, block2) {
    if (event.type === "assistant" && block2.type === "tool_use") {
      this.toolUse(block2);
    } else if (event.type === "user" && block2.type === "tool_result" && block2.is_error) {
      this.toolFailure(block2);
    }
  }
  toolUse(block2) {
    const id = block2.id ?? "";
    const name = block2.name ?? "";
    this.calls.set(id, name);
    this.ordered.push({
      kind: "call",
      id,
      name,
      signature: callSignature(block2.input)
    });
    const skill2 = block2.input?.["skill"];
    if (name === "Skill" && typeof skill2 === "string" && skill2) {
      this.skills.add(skill2);
    }
  }
  toolFailure(block2) {
    this.failedSinceHuman = true;
    const text9 = resultText(block2);
    const tags = new Set(tagsIn(text9));
    if (tags.size === 0) {
      this.failures.push({
        tool: this.calls.get(block2.tool_use_id ?? "") ?? "unknown",
        error: summarizeError(text9)
      });
    }
    for (const tag of tags) {
      this.bump(tag, "blocks");
    }
  }
  attachment(event) {
    const { attachment } = event;
    if (event.type !== "attachment" || attachment?.type !== "hook_additional_context") {
      return;
    }
    for (const rule of tagsIn([attachment.content].flat().join("\n"))) {
      this.bump(rule, "warnings");
      this.warnings.push({ rule, toolUseId: attachment.toolUseID });
    }
  }
  human(event) {
    const text9 = humanText(event);
    if (text9 === null) {
      return;
    }
    this.ordered.push({ kind: "human" });
    const own2 = ownWords(text9);
    if (this.failedSinceHuman || readsAsCorrection(own2)) {
      for (const phrase of phrasesOf(own2)) {
        this.phrases.push({ phrase, line: event.line });
      }
    }
    this.failedSinceHuman = false;
  }
  slash(event) {
    const content = event.message?.content;
    if (typeof content !== "string" || event.type !== "user") {
      return;
    }
    const match = SLASH_COMMAND.exec(content);
    if (match) {
      this.slashCommands.push(match[1] ?? "");
    }
  }
  /** What the agent did after one warning: heeded, repeated, overridden, or unresolved. */
  outcome(warning) {
    const call = this.ordered.findIndex(
      (item) => item.kind === "call" && item.id === warning.toolUseId
    );
    const warned = this.ordered[call];
    if (warned?.kind !== "call") {
      return "unresolved";
    }
    for (const item of this.ordered.slice(call + 1)) {
      if (item.kind === "human") {
        return "overridden";
      }
      if (item.name === warned.name) {
        return item.signature === warned.signature ? "repeated" : "heeded";
      }
    }
    return "unresolved";
  }
};

// src/hook/retro-scan.ts
var MIN_WARNINGS = 5;
var RETRO_MARKER = /^\W*Last retrospective: (\d{4}-\d{2}-\d{2})/gm;
function lastRetrospective(plans) {
  const dates = Object.values(plans).flatMap(
    (markdown) => [...markdown.matchAll(RETRO_MARKER)].map((match) => match[1] ?? "")
  ).sort();
  return dates.at(-1) ?? null;
}
function windowStart(date) {
  return date ? (/* @__PURE__ */ new Date(`${date}T00:00:00`)).getTime() : 0;
}
var emptyStats = () => ({
  warnings: 0,
  sessions: 0,
  heeded: 0,
  overridden: 0,
  repeated: 0,
  unresolved: 0
});
var Tally2 = class {
  constructor(audit3, knownSkills) {
    this.knownSkills = knownSkills;
    this.ruleStats = new Map(audit3.map((rule) => [rule, emptyStats()]));
  }
  knownSkills;
  guards = {};
  failureCounts = /* @__PURE__ */ new Map();
  perSession = {};
  loaded = /* @__PURE__ */ new Set();
  phraseSessions = /* @__PURE__ */ new Map();
  ruleStats;
  add(id, found) {
    this.addGuards(found);
    for (const { tool, error } of found.failures) {
      const key = `${tool}\0${error}`;
      this.failureCounts.set(key, (this.failureCounts.get(key) ?? 0) + 1);
    }
    this.addSkills(id, found);
    this.addPhrases(id, found);
    this.addWarnings(found);
  }
  addGuards(found) {
    for (const [rule, counts] of Object.entries(found.guards)) {
      const total = this.guards[rule] ??= { blocks: 0, warnings: 0 };
      total.blocks += counts.blocks;
      total.warnings += counts.warnings;
    }
  }
  addSkills(id, found) {
    const used = /* @__PURE__ */ new Set([
      ...found.skills,
      ...found.slashCommands.filter((name) => this.knownSkills.includes(name))
    ]);
    for (const name of used) {
      this.loaded.add(name);
    }
    if (used.size > 0) {
      this.perSession[id] = [...used].sort();
    }
  }
  addPhrases(id, found) {
    const seen = /* @__PURE__ */ new Set();
    for (const { phrase, line: line2 } of found.phrases) {
      if (seen.has(phrase)) {
        continue;
      }
      seen.add(phrase);
      const entry2 = this.phraseSessions.get(phrase) ?? [];
      entry2.push({ session: id, line: line2 });
      this.phraseSessions.set(phrase, entry2);
    }
  }
  addWarnings(found) {
    const touched = /* @__PURE__ */ new Set();
    for (const warning of found.warnings) {
      const stats = this.ruleStats.get(warning.rule);
      if (stats) {
        stats.warnings++;
        stats[found.outcome(warning)]++;
        touched.add(stats);
      }
    }
    for (const stats of touched) {
      stats.sessions++;
    }
  }
  failures() {
    return [...this.failureCounts].map(([key, count3]) => {
      const [tool = "", error = ""] = key.split("\0");
      return { tool, error, count: count3 };
    }).sort((a, b) => b.count - a.count).slice(0, 10);
  }
  /** Phrases from the same messages are one correction, so identical evidence merges. */
  corrections() {
    const byEvidence = /* @__PURE__ */ new Map();
    for (const [phrase, evidence] of this.phraseSessions) {
      if (evidence.length < 2) {
        continue;
      }
      const key = JSON.stringify(evidence);
      const group = byEvidence.get(key) ?? { phrases: [], evidence };
      group.phrases.push(phrase);
      byEvidence.set(key, group);
    }
    return [...byEvidence.values()].map(({ phrases, evidence }) => ({
      id: createHash("sha1").update(phrases.sort().join("\n")).digest("hex").slice(0, 8),
      sessions: evidence.length,
      evidence
    })).sort((a, b) => b.sessions - a.sessions);
  }
  rules() {
    const audit3 = [...this.ruleStats].sort(([a], [b]) => a.localeCompare(b)).map(([rule, stats]) => {
      let status2 = "insufficient-evidence";
      if (stats.warnings >= MIN_WARNINGS) {
        status2 = stats.heeded === stats.warnings ? "promotable" : "not-promotable";
      }
      return { rule, status: status2, ...stats };
    });
    return {
      promotable: audit3.filter((r) => r.status === "promotable").map((r) => r.rule),
      audit: audit3
    };
  }
  sortedGuards() {
    return Object.fromEntries(
      Object.entries(this.guards).sort(([a], [b]) => a.localeCompare(b))
    );
  }
  unused() {
    return this.knownSkills.filter((name) => !this.loaded.has(name)).sort();
  }
};
function scan(inputs, { since, knownSkills = [], auditRules: audit3 = [] } = {}) {
  const included = inputs.map(({ id, text: text9 }) => parseTranscript(id, text9)).map((session2) => ({ session: session2, ...timestamps(session2) })).filter(
    ({ last }) => last !== null && Date.parse(last) >= windowStart(since)
  ).sort((a, b) => (a.first ?? "").localeCompare(b.first ?? ""));
  const tally = new Tally2(audit3, knownSkills);
  for (const { session: session2 } of included) {
    tally.add(session2.id, new SessionAnalysis(session2));
  }
  const firsts = included.flatMap((item) => item.first ?? []).sort();
  const lasts = included.flatMap((item) => item.last ?? []).sort();
  return {
    sessions: {
      count: included.length,
      first: firsts[0] ?? null,
      last: lasts.at(-1) ?? null,
      list: included.map(({ session: session2, first, last }) => ({
        id: session2.id,
        first,
        last
      }))
    },
    skippedLines: included.reduce((sum, item) => sum + item.session.skipped, 0),
    guards: tally.sortedGuards(),
    failures: tally.failures(),
    skills: { perSession: tally.perSession, unused: tally.unused() },
    corrections: tally.corrections(),
    rules: tally.rules()
  };
}

// src/hook/context.ts
var PLANS_DIR2 = "infra/plans";
var RETRO_AFTER_SESSIONS = 5;
function rules(agentsMarkdown) {
  return listItems(agentsMarkdown).map((item) => item.text);
}
function lastOperation(entries) {
  const start = entries.findLast((entry2) => entry2.kind === "start");
  if (!start) {
    return null;
  }
  const end = entries.findLast(
    (entry2) => entry2.kind === "end" && entry2.op === start.op
  );
  return {
    command: start.command,
    ts: start.ts,
    outcome: end?.outcome ?? null,
    error: end?.error
  };
}
var show2 = (value) => typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value) ?? "";
function environmentLines(journals) {
  const lines2 = [];
  for (const environment of Object.keys(journals).sort()) {
    const last = lastOperation(journals[environment] ?? []);
    if (!last) {
      continue;
    }
    const date = show2(last.ts).slice(0, 10);
    const label = `Environment ${environment}: last operation \`${show2(last.command)}\``;
    if (last.outcome === null) {
      lines2.push(
        `${label} was interrupted (started ${date}, no end recorded).`
      );
    } else if (last.outcome === "failed") {
      const reason = last.error ? `: ${show2(last.error)}` : "";
      lines2.push(`${label} failed on ${date}${reason}.`);
    } else {
      lines2.push(`${label} ${show2(last.outcome)} on ${date}.`);
    }
  }
  return lines2;
}
async function brief(event, deps) {
  const plans = await deps.readPlans();
  const lines2 = [];
  for (const plan2 of activePlans(plans)) {
    const markdown = plans[plan2] ?? "";
    lines2.push(`Session brief from ${PLANS_DIR2}/${plan2}:`);
    const counts = openCounts(markdown).map(({ step, count: count3 }) => `${step} (${count3})`).join(", ");
    if (counts) {
      lines2.push(`Open items: ${counts}.`);
    }
    const next = nextStep(markdown);
    if (next) {
      lines2.push(`Next (${next.step}): ${next.text}`);
    }
    const upcoming = upcomingSteps(markdown);
    if (upcoming.length > 0) {
      lines2.push(`Upcoming: ${upcoming.join("; ")}.`);
    }
  }
  lines2.push(...environmentLines(await deps.readJournals()));
  const since = lastRetrospective(plans);
  const id = typeof event.session_id === "string" ? event.session_id : void 0;
  const sessions = await deps.sessionsSince(since, id);
  if (sessions >= RETRO_AFTER_SESSIONS) {
    lines2.push(
      since ? `${sessions} sessions since the last retrospective (${since}); run /retro.` : `${sessions} sessions without a recorded retrospective; run /retro.`
    );
  }
  return lines2.join("\n");
}
async function restore(event, deps) {
  if (event.source === "startup" || event.source === "clear") {
    return brief(event, deps);
  }
  if (event.source !== "compact") {
    return "";
  }
  const sections = [
    "Context was compacted. Keep applying these AGENTS.md rules; hooks check only the parts marked Enforced or Audited:",
    ...rules(await deps.readAgents())
  ];
  const plans = await deps.readPlans();
  for (const plan2 of activePlans(plans)) {
    sections.push(
      "",
      `Open plan items in ${PLANS_DIR2}/${plan2}:`,
      ...openItems(plans[plan2] ?? "")
    );
  }
  return sections.join("\n");
}

// src/hook/context-deps.ts
import { homedir } from "node:os";
import { join as join9 } from "node:path";
var JOURNAL_DIR = ".kore/state/journal";
var isMissing = (error) => error.code === "ENOENT";
function parseEntries(text9) {
  const entries = [];
  for (const line2 of text9.split("\n")) {
    try {
      const entry2 = JSON.parse(line2);
      if (entry2 && typeof entry2 === "object") {
        entries.push(entry2);
      }
    } catch {
    }
  }
  return entries;
}
async function readJournals(fs, root3) {
  const dir = join9(root3, JOURNAL_DIR);
  let names3;
  try {
    names3 = (await fs.readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  } catch (error) {
    if (isMissing(error)) {
      return {};
    }
    throw error;
  }
  const journals = {};
  for (const name of names3) {
    let text9;
    try {
      text9 = await fs.readFile(join9(dir, name));
    } catch {
      continue;
    }
    journals[name.slice(0, -".jsonl".length)] = parseEntries(text9);
  }
  return journals;
}
async function sessionsSince(deps, root3, date, current) {
  const config = deps.env["CLAUDE_CONFIG_DIR"] || join9(homedir(), ".claude");
  const dir = join9(config, "projects", root3.replace(/[^a-zA-Z0-9]/g, "-"));
  let names3;
  try {
    names3 = await deps.fs.readdir(dir);
  } catch (error) {
    if (isMissing(error)) {
      return 0;
    }
    throw error;
  }
  const after = windowStart(date ?? void 0);
  let count3 = 0;
  for (const name of names3) {
    if (name.endsWith(".jsonl") && name !== `${current}.jsonl` && await deps.fs.mtimeMs(join9(dir, name)) >= after) {
      count3 += 1;
    }
  }
  return count3;
}
function realContextDeps(deps, root3) {
  return {
    readJournals: () => readJournals(deps.fs, root3),
    readAgents: () => deps.fs.readFile(join9(root3, "AGENTS.md")),
    readPlans: () => readPlans(deps),
    sessionsSince: (date, current) => sessionsSince(deps, root3, date, current)
  };
}

// src/hook/context-command.ts
var context = hookCommand(
  "context",
  "restate the rules and open plan items after compaction, or brief a fresh session (SessionStart)",
  async ({ deps, payload }) => {
    if (typeof payload !== "object" || payload === null) {
      return {};
    }
    if (Array.isArray(payload)) {
      return {};
    }
    let text9;
    try {
      text9 = await restore(
        payload,
        realContextDeps(deps, await deps.root())
      );
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      }
      throw error;
    }
    return text9 === "" ? {} : {
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: text9
        }
      })
    };
  },
  { faultCode: 1 }
);

// src/hook/delta-deps.ts
import { join as join10, resolve as resolve6 } from "node:path";
var JOURNAL_DIR2 = ".kore/state/journal";
var LOCKS_DIR = ".kore/locks";
function gitReader(deps, root3) {
  return async (...args) => {
    const result = await deps.runner.run("git", args, { cwd: root3 });
    if (result.code !== 0) {
      throw new Error(`git ${args.join(" ")} exited ${result.code}`);
    }
    return result.stdout.trim();
  };
}
async function readDir(deps, dir) {
  try {
    return await deps.fs.readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
function parseEntries2(text9) {
  const entries = [];
  for (const line2 of text9.split("\n")) {
    try {
      const entry2 = JSON.parse(line2);
      if (entry2 !== null && typeof entry2 === "object") {
        entries.push(entry2);
      }
    } catch {
    }
  }
  return entries;
}
async function readJournals2(deps, root3) {
  const dir = join10(root3, JOURNAL_DIR2);
  const journals = {};
  for (const name of await readDir(deps, dir)) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    try {
      journals[name.slice(0, -".jsonl".length)] = parseEntries2(
        await deps.fs.readFile(join10(dir, name))
      );
    } catch {
    }
  }
  return journals;
}
function snapshotStore(deps, git3, root3) {
  const dir = async () => join10(resolve6(root3, await git3("rev-parse", "--git-dir")), "kore-delta");
  const file = async (id) => join10(await dir(), `${id}.json`);
  return {
    async readSnapshot(id) {
      try {
        return JSON.parse(await deps.fs.readFile(await file(id)));
      } catch {
        return null;
      }
    },
    async writeSnapshot(id, snapshot2) {
      await deps.fs.writeFile(await file(id), JSON.stringify(snapshot2));
    },
    async listSnapshots() {
      const base = await dir();
      const found = [];
      for (const name of await readDir(deps, base)) {
        if (name.endsWith(".json")) {
          found.push({
            id: name.slice(0, -".json".length),
            mtimeMs: await deps.fs.mtimeMs(join10(base, name))
          });
        }
      }
      return found;
    },
    async removeSnapshot(id) {
      await deps.fs.remove(await file(id));
    }
  };
}
function realDeltaDeps(deps, root3) {
  const git3 = gitReader(deps, root3);
  return {
    now: () => deps.clock.now().getTime(),
    head: () => git3("rev-parse", "HEAD"),
    branch: () => git3("rev-parse", "--abbrev-ref", "HEAD"),
    async main() {
      try {
        return await git3("rev-parse", "--verify", "--quiet", "main");
      } catch {
        return null;
      }
    },
    async commitsBetween(from, to) {
      return (await git3("log", "--format=%s", `${from}..${to}`)).split("\n").filter(Boolean);
    },
    readPlans: () => readPlans(deps),
    listLocks: () => readDir(deps, join10(root3, LOCKS_DIR)),
    readJournals: () => readJournals2(deps, root3),
    ...snapshotStore(deps, git3, root3)
  };
}

// src/hook/delta.ts
var MAX_CHARS = 600;
var MAX_ITEM_CHARS = 60;
var MAX_SUBJECTS = 3;
var SNAPSHOT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1e3;
function lastOperation2(entries) {
  const start = entries.findLast((entry2) => entry2.kind === "start");
  if (start === void 0) {
    return null;
  }
  const end = entries.findLast(
    (entry2) => entry2.kind === "end" && entry2.op === start.op
  );
  return {
    op: start.op ?? "",
    command: start.command ?? "",
    outcome: end?.outcome ?? null,
    ...end?.error ? { error: end.error } : {}
  };
}
function planItems(plans) {
  const result = {};
  for (const name of activePlans(plans)) {
    const items2 = {};
    for (const { text: text9 } of listItems(plans[name] ?? "")) {
      const match = /^- \[( |x)\] (.*)$/.exec(text9);
      if (match === null) {
        continue;
      }
      const title = (match[2] ?? "").replaceAll("**", "").slice(0, MAX_ITEM_CHARS);
      items2[title] = match[1] === "x";
    }
    result[name] = items2;
  }
  return result;
}
async function snapshot(deps) {
  const journal = {};
  for (const [environment, entries] of Object.entries(
    await deps.readJournals()
  )) {
    const last = lastOperation2(entries);
    if (last !== null) {
      journal[environment] = last;
    }
  }
  return {
    head: await deps.head(),
    branch: await deps.branch(),
    main: await deps.main(),
    plans: planItems(await deps.readPlans()),
    locks: [...await deps.listLocks()].sort(),
    journal
  };
}
function operationLine(environment, operation) {
  const command = `\`${operation.command}\``;
  if (operation.outcome === null) {
    return `${environment}: ${command} started`;
  }
  if (operation.outcome === "failed") {
    return `${environment}: ${command} failed${operation.error ? `: ${operation.error}` : ""}`;
  }
  return `${environment}: ${command} finished ${operation.outcome}`;
}
function planLines(before2, after) {
  const lines2 = [];
  for (const [plan2, items2] of Object.entries(after.plans)) {
    const old = before2.plans[plan2];
    const ticked = [];
    const added = [];
    for (const [title, checked] of Object.entries(items2)) {
      if (old === void 0 || !(title in old)) {
        if (old !== void 0) {
          added.push(title);
        }
      } else if (checked && old[title] !== true) {
        ticked.push(title);
      }
    }
    if (ticked.length > 0) {
      lines2.push(`${plan2} ticked: ${ticked.join("; ")}`);
    }
    if (added.length > 0) {
      lines2.push(`${plan2} added: ${added.join("; ")}`);
    }
  }
  return lines2;
}
function mainLine(before2, after, subjects) {
  if (before2.main === after.main || after.main === null) {
    return [];
  }
  const found = before2.main === null ? [] : subjects(before2.main, after.main);
  if (found.length === 0) {
    return [`main moved to ${after.main.slice(0, 7)}.`];
  }
  const shown = found.slice(0, MAX_SUBJECTS).join("; ");
  const more = found.length > MAX_SUBJECTS ? "; ..." : "";
  const plural = found.length === 1 ? "commit" : "commits";
  return [`main advanced ${found.length} ${plural}: ${shown}${more}`];
}
function lockLines(before2, after) {
  return [
    ...after.locks.filter((lock) => !before2.locks.includes(lock)).map((lock) => `lock taken: ${lock}`),
    ...before2.locks.filter((lock) => !after.locks.includes(lock)).map((lock) => `lock released: ${lock}`)
  ];
}
function journalLines(before2, after) {
  return Object.entries(after.journal).filter(([environment, operation]) => {
    const old = before2.journal[environment];
    return old?.op !== operation.op || old.outcome !== operation.outcome;
  }).map(([environment, operation]) => operationLine(environment, operation));
}
function describeChanges(before2, after, subjects) {
  const lines2 = [
    ...mainLine(before2, after, subjects),
    ...before2.branch === after.branch ? [] : [`branch changed from ${before2.branch} to ${after.branch}.`],
    ...planLines(before2, after),
    ...lockLines(before2, after),
    ...journalLines(before2, after)
  ];
  if (lines2.length === 0) {
    return "";
  }
  const text9 = `Changed since your last turn: ${lines2.join(" | ")}`;
  return text9.length <= MAX_CHARS ? text9 : `${text9.slice(0, MAX_CHARS - 3)}...`;
}
async function prune(currentId, deps) {
  try {
    const cutoff = deps.now() - SNAPSHOT_MAX_AGE_MS;
    for (const { id, mtimeMs } of await deps.listSnapshots()) {
      if (id === currentId || mtimeMs >= cutoff) {
        continue;
      }
      try {
        await deps.removeSnapshot(id);
      } catch {
      }
    }
  } catch {
  }
}
async function update(sessionId, deps) {
  try {
    const before2 = await deps.readSnapshot(sessionId);
    const after = await snapshot(deps);
    await deps.writeSnapshot(sessionId, after);
    await prune(sessionId, deps);
    if (before2 === null) {
      return "";
    }
    const subjects = /* @__PURE__ */ new Map();
    if (before2.main !== after.main && before2.main !== null && after.main !== null) {
      subjects.set(
        `${before2.main}..${after.main}`,
        await deps.commitsBetween(before2.main, after.main)
      );
    }
    return describeChanges(
      before2,
      after,
      (from, to) => subjects.get(`${from}..${to}`) ?? []
    );
  } catch {
    return "";
  }
}

// src/hook/delta-command.ts
var delta = hookCommand(
  "delta",
  "tell the agent what changed since its previous turn (UserPromptSubmit)",
  async ({ deps, payload }) => {
    const id = payload?.session_id;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) {
      return {};
    }
    const context2 = await update(id, realDeltaDeps(deps, await deps.root()));
    return context2 === "" ? {} : {
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: context2
        }
      })
    };
  }
);

// src/hook/record.ts
var STARTS = /* @__PURE__ */ new Set(["startup", "clear", "resume"]);
var record3 = hookCommand(
  "record",
  "record a ledger event for the session; mode: session-start (SessionStart, no matcher)",
  async ({ deps, payload, operand }) => {
    if (typeof payload !== "object" || payload === null) {
      return {};
    }
    const call = payload;
    if (operand === "session-start" && typeof call.source === "string" && STARTS.has(call.source)) {
      await recordEvent(deps, "session.start", call);
    }
    return {};
  },
  { operand: "mode" }
);

// src/hook/statusline.ts
var AMBER_AT = 40;
var RED_AT = 50;
function contextPercent(input) {
  const window = input.context_window;
  if (typeof window?.used_percentage === "number") {
    return Math.round(window.used_percentage);
  }
  const usage2 = window?.current_usage;
  if (!usage2 || !window?.context_window_size) {
    return null;
  }
  const used = (usage2.input_tokens ?? 0) + (usage2.cache_creation_input_tokens ?? 0) + (usage2.cache_read_input_tokens ?? 0);
  return Math.round(used / window.context_window_size * 100);
}
function colored(percent) {
  const text9 = `ctx ${percent}%`;
  if (percent >= RED_AT) {
    return `\x1B[31m${text9}\x1B[0m`;
  }
  if (percent >= AMBER_AT) {
    return `\x1B[33m${text9}\x1B[0m`;
  }
  return text9;
}
function statusLine(input, plans) {
  const parts = [];
  const percent = contextPercent(input);
  if (percent !== null) {
    parts.push(colored(percent));
  }
  const name = activePlans(plans)[0];
  if (name !== void 0) {
    const markdown = plans[name] ?? "";
    parts.push(name.replace(/\.md$/, ""));
    const next = nextStep(markdown);
    if (next) {
      parts.push(next.step.split(":")[0] ?? next.step);
    }
    const open2 = openCounts(markdown).reduce((sum, c) => sum + c.count, 0);
    parts.push(`${open2} open`);
  }
  return parts.join(" \xB7 ");
}
var text8 = (value) => typeof value === "string" && value !== "" ? value : void 0;
function projectOf(input, deps) {
  return text8(deps.env["CLAUDE_PROJECT_DIR"]) ?? text8(input.workspace?.project_dir) ?? text8(input.cwd) ?? deps.cwd;
}
var UNREADABLE = "plans?";
var statusline = hookCommand(
  "statusline",
  "print one status line from the host's JSON: context use, the active plan, its Next: step and open items",
  async ({ deps, payload }) => {
    if (typeof payload !== "object" || payload === null) {
      return {};
    }
    if (Array.isArray(payload)) {
      return {};
    }
    const input = payload;
    const root3 = projectOf(input, deps);
    let line2;
    try {
      line2 = statusLine(
        input,
        await readPlans({ ...deps, root: () => Promise.resolve(root3) })
      );
    } catch {
      const percent = contextPercent(input);
      line2 = [percent === null ? null : colored(percent), UNREADABLE].filter((part) => part !== null).join(" \xB7 ");
    }
    return line2 === "" ? {} : { stdout: `${line2}
` };
  }
);

// src/hook/retro-hook.ts
import { homedir as homedir2 } from "node:os";
import { join as join12 } from "node:path";

// src/hook/retro-transcripts.ts
import { basename as basename2, join as join11, sep } from "node:path";
var PROBE_BYTES = 256 * 1024;
var DEFAULT_BRANCHES = /* @__PURE__ */ new Set(["main", "master", "HEAD"]);
var encodePath = (path) => path.replace(/[^a-zA-Z0-9]/g, "-");
var insideOf = (path, base) => path === base || path.startsWith(base + sep);
function lineBelongs(line2, roots, branches) {
  try {
    const event = JSON.parse(line2);
    const cwdInside = typeof event.cwd === "string" && roots.some((root3) => insideOf(event.cwd, root3));
    return cwdInside || branches.has(event.gitBranch);
  } catch {
    return false;
  }
}
async function repoTranscriptDirs(fs, projectsDir, { main, worktrees, branches }) {
  const roots = [.../* @__PURE__ */ new Set([main, ...worktrees])];
  const names3 = new Set(roots.map(encodePath));
  const branchSet = new Set(branches.filter((b) => !DEFAULT_BRANCHES.has(b)));
  const belongs = async (dir) => {
    let files;
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      return false;
    }
    for (const file of files) {
      let head;
      try {
        head = await fs.readHead(join11(dir, file), PROBE_BYTES);
      } catch {
        continue;
      }
      if (head.includes(main) || head.split("\n").some((line2) => lineBelongs(line2, roots, branchSet))) {
        return true;
      }
    }
    return false;
  };
  let entries;
  try {
    entries = await fs.readdir(projectsDir);
  } catch {
    return [];
  }
  const found = [];
  for (const name of entries) {
    const dir = join11(projectsDir, name);
    if (await fs.isDirectory(dir) && (names3.has(basename2(dir)) || await belongs(dir))) {
      found.push(dir);
    }
  }
  return found.sort();
}
async function git(runner, cwd, args) {
  const result = await runner.run("git", args, { cwd });
  return result.code === 0 ? result.stdout : "";
}
async function defaultDirs(fs, runner, root3, home) {
  const listed = await git(runner, root3, ["worktree", "list", "--porcelain"]);
  const worktrees = listed.split("\n").filter((line2) => line2.startsWith("worktree ")).map((line2) => line2.slice("worktree ".length));
  const common = (await git(runner, root3, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir"
  ])).trim();
  const main = worktrees[0] ?? (common ? join11(common, "..") : root3);
  const refs = await git(runner, root3, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
    "refs/remotes"
  ]);
  const branches = refs.split("\n").filter(Boolean).map((name) => name.replace(/^origin\//, ""));
  return await repoTranscriptDirs(fs, join11(home, ".claude", "projects"), {
    main,
    worktrees: worktrees.length > 0 ? worktrees : [main],
    branches
  });
}
async function readTranscripts(fs, dirs) {
  const byId = /* @__PURE__ */ new Map();
  for (const dir of dirs) {
    for (const name of (await fs.readdir(dir)).filter(
      (n) => n.endsWith(".jsonl")
    )) {
      const id = basename2(name, ".jsonl");
      const text9 = await fs.readFile(join11(dir, name));
      if (text9.length >= (byId.get(id)?.text.length ?? -1)) {
        byId.set(id, { id, text: text9 });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// src/hook/retro-hook.ts
var USAGE = "Usage: harness hook retro-scan [--dir <transcripts>] [--since YYYY-MM-DD]\n--since keeps sessions active at or after local midnight of that date, like the session-start count.";
var isMissing2 = (error) => error.code === "ENOENT";
async function skillNames(fs, root3) {
  const dir = join12(root3, "skills");
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if (isMissing2(error)) {
      return void 0;
    }
    throw error;
  }
  const names3 = [];
  for (const entry2 of entries) {
    if (await fs.isDirectory(join12(dir, entry2)) && await fs.exists(join12(dir, entry2, "SKILL.md"))) {
      names3.push(entry2);
    }
  }
  return names3;
}
async function transcripts(deps, root3, dir) {
  let dirs = [];
  try {
    dirs = dir ? [dir] : await defaultDirs(
      deps.fs,
      deps.runner,
      root3,
      deps.env["HOME"] ?? homedir2()
    );
    const inputs = await readTranscripts(deps.fs, dirs);
    if (!dir && inputs.length === 0) {
      return `No transcripts found for this repository or its worktrees. Pass --dir <transcripts>.
${USAGE}
`;
    }
    return { inputs };
  } catch {
    return `Cannot read transcripts in ${dirs.join(", ") || "any project directory"}. Pass --dir <transcripts>.
${USAGE}
`;
  }
}
async function auditRules(deps, root3) {
  try {
    return auditRuleNames(
      await readInventory((p) => deps.fs.readFile(p), root3)
    );
  } catch (error) {
    if (error instanceof GuardrailError) {
      throw new CommandError(error.message);
    }
    throw error;
  }
}
async function report2(deps, { dir, since }) {
  const root3 = await deps.root();
  const found = await transcripts(deps, root3, dir);
  if (typeof found === "string") {
    return { code: 2, stderr: found };
  }
  let stderr2 = "";
  const effective = since ?? (dir ? void 0 : lastRetrospective(await readPlans(deps)) ?? void 0);
  const skills = await skillNames(deps.fs, root3);
  if (skills === void 0) {
    stderr2 += "No skills/ directory found; skills.unused will be empty.\n";
  }
  const audit3 = await auditRules(deps, root3);
  if (effective === void 0 && !dir) {
    stderr2 += "No `Last retrospective:` date found; scanning all sessions. Pass --since to narrow.\n";
  }
  const result = scan(found.inputs, {
    since: effective,
    knownSkills: skills ?? [],
    auditRules: audit3
  });
  const body = { since: effective ?? null, ...result };
  return { stdout: `${JSON.stringify(body, null, 2)}
`, stderr: stderr2 };
}
var retroScan = hookCommand(
  "retro-scan",
  "count guard blocks, failures, skills and repeated corrections over session transcripts (retro skill input)",
  async ({ deps, options }) => {
    const since = options["since"];
    if (typeof since === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
      return { code: 2, stderr: `${USAGE}
` };
    }
    const dir = options["dir"];
    return await report2(deps, {
      dir: typeof dir === "string" ? dir : void 0,
      since: typeof since === "string" ? since : void 0
    });
  },
  { flags: { dir: "string", since: "string" }, payload: false }
);

// src/hook/skill-links.ts
import { isAbsolute as isAbsolute3, join as join13 } from "node:path";
var HARNESSES = [".claude", ".codex"];
async function skillNames2(fs, root3) {
  const skillsDir = join13(root3, "skills");
  let entries;
  try {
    entries = await fs.readdir(skillsDir);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new CommandError(
        `No skills directory at ${skillsDir}. Run from the repository, or set CLAUDE_PROJECT_DIR to its root.`
      );
    }
    throw error;
  }
  const skills = [];
  for (const entry2 of entries) {
    if (await fs.exists(join13(root3, "skills", entry2, "SKILL.md"))) {
      skills.push(entry2);
    }
  }
  return skills.sort();
}
async function targetOf(fs, path) {
  try {
    return { target: await fs.readlink(path) };
  } catch (error) {
    const code = error.code;
    if (code === "EINVAL" || code === "ENOENT") {
      return { code };
    }
    throw error;
  }
}
async function linkProblems(fs, root3) {
  const skills = await skillNames2(fs, root3);
  const problems = [];
  for (const harness of HARNESSES) {
    for (const skill2 of skills) {
      const link = `${harness}/skills/${skill2}`;
      const expected = `../../skills/${skill2}`;
      const found = await targetOf(fs, join13(root3, link));
      if ("code" in found) {
        problems.push(
          found.code === "EINVAL" ? `${link} is a directory or file, not a link; replace it with a link to ${expected}` : `${link} is missing; link it to ${expected}`
        );
      } else if (isAbsolute3(found.target)) {
        problems.push(
          `${link} links to an absolute path; relink it to ${expected}`
        );
      } else if (found.target !== expected) {
        problems.push(
          `${link} links to ${found.target}; relink it to ${expected}`
        );
      }
    }
  }
  return problems;
}

// src/hook/workflow-permissions.ts
import { join as join14 } from "node:path";
var RELEASE = "release.yaml";
var SIGNING_JOBS = ["release", "mirror"];
var SIGNING_SCOPES = ["id-token", "packages"];
var TAG_GATE = "github.ref_type == 'tag'";
var PR_TRIGGERS = ["pull_request", "pull_request_target"];
var isMap = (value) => typeof value === "object" && value !== null;
function addEntry2(stack, indent, body) {
  const match = /^["']?([^:"']+)["']?:\s*(.*)$/.exec(body);
  if (!match) {
    return null;
  }
  const key = match[1];
  while (stack[stack.length - 1].indent >= indent) {
    stack.pop();
  }
  const parent = stack[stack.length - 1].node;
  const value = match[2].trim();
  if (value === "") {
    const child = {};
    parent[key] = child;
    stack.push({ indent, node: child });
    return null;
  }
  parent[key] = value;
  return /^[|>]/.test(value) ? indent : null;
}
function parseWorkflow(text9) {
  const rootNode = {};
  const stack = [{ indent: -1, node: rootNode }];
  let skipAbove = null;
  for (const raw of text9.split("\n")) {
    const line2 = raw.replace(/(^|\s)#.*$/, "");
    const indent = line2.length - line2.trimStart().length;
    if (line2.trim() === "" || skipAbove !== null && indent > skipAbove) {
      continue;
    }
    skipAbove = null;
    const body = line2.trim();
    if (body.startsWith("-")) {
      skipAbove = indent - 1;
      continue;
    }
    skipAbove = addEntry2(stack, indent, body);
  }
  return rootNode;
}
function writeScopes(permissions2) {
  if (permissions2 === void 0) {
    return null;
  }
  if (isMap(permissions2)) {
    return Object.entries(permissions2).filter(([, level]) => level === "write").map(([scope]) => scope);
  }
  if (permissions2 === "write-all") {
    return ["write-all"];
  }
  return [...permissions2.matchAll(/([\w-]+)\s*:\s*write\b/g)].map(
    (m) => m[1]
  );
}
function triggers(on) {
  if (isMap(on)) {
    return Object.keys(on);
  }
  return String(on ?? "").replace(/[[\]]/g, "").split(",").map((t) => t.trim()).filter(Boolean);
}
function jobProblems(file, name, job) {
  const scopes = isMap(job) ? writeScopes(job["permissions"]) : null;
  if (scopes === null || !isMap(job)) {
    return [
      `${file}: job ${name} needs explicit permissions; add \`permissions: {}\` or the read scopes it uses`
    ];
  }
  const isRelease = file === RELEASE;
  const signing = scopes.filter((s) => SIGNING_SCOPES.includes(s));
  const allowedSigner = isRelease && SIGNING_JOBS.includes(name);
  const problems = [];
  if (!allowedSigner) {
    for (const scope of signing) {
      problems.push(
        `${file}: job ${name} requests ${scope}: write; only the ${SIGNING_JOBS.join(" and ")} jobs of ${RELEASE} may sign or push, so drop it`
      );
    }
  }
  const gate = job["if"];
  if (allowedSigner && signing.length > 0 && !(typeof gate === "string" && gate.includes(TAG_GATE))) {
    problems.push(
      `${file}: signing job ${name} must run only for tags; add \`if: ${TAG_GATE}\``
    );
  }
  if (!isRelease) {
    for (const scope of scopes.filter((s) => !SIGNING_SCOPES.includes(s))) {
      problems.push(
        `${file}: job ${name} requests ${scope}: write; only ${RELEASE} may write, so drop it`
      );
    }
  }
  return problems;
}
function fileProblems(file, text9) {
  const workflow = parseWorkflow(text9);
  const problems = [];
  const top = writeScopes(workflow["permissions"]);
  if (top === null || top.length > 0) {
    problems.push(
      `${file}: top-level permissions must be present and read-only; add \`permissions: {}\` or \`contents: read\``
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
        `${file}: must not run on ${trigger}; a pull request could mint a trusted signature, so remove the trigger`
      );
    }
  }
  return problems;
}
function permissionProblems(files) {
  return Object.entries(files).flatMap(
    ([file, text9]) => fileProblems(file, text9)
  );
}
async function workflowProblems(fs, root3) {
  const dir = join14(root3, ".github", "workflows");
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new CommandError(
        `No workflows directory at ${dir}. Run from the repository, or set CLAUDE_PROJECT_DIR to its root.`
      );
    }
    throw error;
  }
  const files = {};
  for (const entry2 of entries.filter((f) => /\.ya?ml$/.test(f)).sort()) {
    files[entry2] = await fs.readFile(join14(dir, entry2));
  }
  return permissionProblems(files);
}

// src/kb/markdown.ts
import { posix } from "node:path";
var DATE = /^\d{4}-\d{2}-\d{2}$/;
var LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
function finding(file, line2, message, fix2) {
  return { file, line: line2, message, fix: fix2 };
}
function slug(heading) {
  return heading.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-");
}
function proseLines(markdown) {
  const lines2 = [];
  let fence = null;
  markdown.split("\n").forEach((text9, index) => {
    const opener = /^\s*(```|~~~)/.exec(text9);
    if (fence) {
      if (opener && opener[1] === fence) {
        fence = null;
      }
      return;
    }
    if (opener) {
      fence = opener[1] ?? null;
      return;
    }
    lines2.push({ line: index + 1, text: text9.replace(/`[^`]*`/g, "") });
  });
  return lines2;
}
function anchors(markdown) {
  const seen = /* @__PURE__ */ new Map();
  const result = [];
  for (const { text: text9 } of proseLines(markdown)) {
    const match = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(text9);
    if (!match) {
      continue;
    }
    const base = slug(match[1] ?? "");
    const count3 = seen.get(base) ?? 0;
    seen.set(base, count3 + 1);
    result.push(count3 ? `${base}-${count3}` : base);
  }
  return result;
}
function resolve7(from, target) {
  const joined = posix.normalize(posix.join(posix.dirname(from), target));
  if (joined === ".." || joined.startsWith("../")) {
    return null;
  }
  return joined.replace(/\/$/, "") || ".";
}
function isExternal(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
}
function frontmatter2(file, markdown) {
  const lines2 = markdown.split("\n");
  if (lines2[0] !== "---") {
    return null;
  }
  const keys = /* @__PURE__ */ new Map();
  const errors = [];
  for (let index = 1; index < lines2.length; index++) {
    const text9 = lines2[index] ?? "";
    if (text9 === "---") {
      return { keys, errors };
    }
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(text9);
    if (match?.[2] && !/^[[{|>&*!-]/.test(match[2])) {
      keys.set(match[1] ?? "", { value: match[2].trim(), line: index + 1 });
    } else {
      const key = match ? match[1] : text9.trim();
      errors.push(
        finding(
          file,
          index + 1,
          `frontmatter ${key} is not a scalar string`,
          "use flat key: value lines only"
        )
      );
    }
  }
  return null;
}

// src/kb/document-checks.ts
var ADR = /^docs\/decisions\/[^/]+\.md$/;
function valueProblems(file, keys, adr) {
  const problems = [];
  const statuses = adr ? ["proposed", "accepted", "superseded"] : ["active", "done"];
  const status2 = keys.get("status");
  if (status2 && !statuses.includes(status2.value)) {
    problems.push(
      finding(
        file,
        status2.line,
        `frontmatter status is ${status2.value}`,
        `use one of ${statuses.join(", ")}`
      )
    );
  }
  for (const key of ["date", "last-verified"]) {
    const entry2 = keys.get(key);
    if (entry2 && (adr || key !== "date") && !DATE.test(entry2.value)) {
      problems.push(
        finding(
          file,
          entry2.line,
          `frontmatter ${key} is ${entry2.value}`,
          "use a YYYY-MM-DD date"
        )
      );
    }
  }
  return problems;
}
function checkFrontmatter(file, markdown, exists) {
  const parsed = frontmatter2(file, markdown);
  if (!parsed) {
    return [
      finding(
        file,
        1,
        "frontmatter is missing",
        "start the file with --- status, summary, and last-verified ---"
      )
    ];
  }
  const adr = ADR.test(file);
  const required = adr ? ["status", "date", "summary", "last-verified"] : ["status", "summary", "last-verified"];
  const { keys } = parsed;
  if (adr && keys.get("status")?.value === "superseded") {
    required.push("superseded-by");
  }
  const problems = [...parsed.errors, ...valueProblems(file, keys, adr)];
  const replacement = keys.get("superseded-by");
  if (adr && replacement && !exists(replacement.value)) {
    problems.push(
      finding(
        file,
        replacement.line,
        `frontmatter superseded-by ${replacement.value} does not exist`,
        "use the replacing ADR's path from the repository root"
      )
    );
  }
  problems.sort((a, b) => a.line - b.line);
  for (const key of required) {
    if (!keys.has(key)) {
      problems.push(
        finding(file, 1, `frontmatter ${key} is missing`, `add a ${key}: line`)
      );
    }
  }
  return problems;
}

// src/kb/idea-checks.ts
var IDEA_NAME = /^docs\/ideas\/(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
var IDEA_REQUIRED = [
  "summary",
  "hypothesis",
  "expected-outcome",
  "measurement",
  "safety-pattern",
  "date"
];
var IDEA_OUTCOMES = ["confirmed", "refuted", "inconclusive"];
var SAFETY_PATTERNS2 = [
  "no-behaviour-change",
  "feature-flagged",
  "dark-launched",
  "branch-by-abstraction",
  "expand-contract"
];
var WORKFLOW_KEYS = [
  "status",
  "approval",
  "approved",
  "approved-by",
  "label",
  "labels",
  "assignee",
  "assignees",
  "state"
];
var onKey = (file, keys, key, message, fix2) => finding(file, keys.get(key)?.line ?? 1, message, fix2);
function valueProblems2(file, keys) {
  const problems = [];
  const bad3 = (key, message, fix2) => problems.push(onKey(file, keys, key, message, fix2));
  const oneOf = (key, allowed) => {
    const entry2 = keys.get(key);
    if (entry2 && !allowed.includes(entry2.value)) {
      bad3(
        key,
        `frontmatter ${key} is ${entry2.value}`,
        `use one of ${allowed.join(", ")}`
      );
    }
  };
  oneOf("safety-pattern", SAFETY_PATTERNS2);
  oneOf("outcome", IDEA_OUTCOMES);
  const date = keys.get("date");
  if (date && !DATE.test(date.value)) {
    bad3("date", `frontmatter date is ${date.value}`, "use a YYYY-MM-DD date");
  }
  for (const key of WORKFLOW_KEYS.filter((name) => keys.has(name))) {
    bad3(
      key,
      `frontmatter ${key} is workflow state`,
      "the GitHub issue owns it, so remove the line"
    );
  }
  const issue = keys.get("issue");
  if (issue && !/^#?\d+$|^https:\/\/\S+$/.test(issue.value)) {
    bad3(
      "issue",
      `frontmatter issue is ${issue.value}`,
      "use an issue number such as 185 or #185, or its URL"
    );
  }
  return problems;
}
function parentProblems(file, keys, ideas2) {
  const parent = keys.get("parent");
  if (!parent || /^#\d+$/.test(parent.value)) {
    return [];
  }
  const number = /^(\d{4})(?:-[a-z0-9-]+)?$/.exec(parent.value)?.[1];
  if (number === void 0) {
    return [
      onKey(
        file,
        keys,
        "parent",
        `frontmatter parent is ${parent.value}`,
        "use an idea number such as 0001, or an issue such as #127"
      )
    ];
  }
  return ideas2.has(number) ? [] : [
    onKey(
      file,
      keys,
      "parent",
      `frontmatter parent is ${parent.value}; idea ${number} does not exist`,
      "use an existing idea's number or an issue such as #127"
    )
  ];
}
function outcomeProblems(file, markdown, keys) {
  const heading = markdown.split("\n").findIndex((l) => /^## Outcome\s*$/.test(l));
  const outcome = keys.get("outcome");
  if (outcome && heading === -1) {
    return [
      onKey(
        file,
        keys,
        "outcome",
        "frontmatter outcome has no ## Outcome section",
        `run \`harness outcome record --idea ${Number(IDEA_NAME.exec(file)?.[1] ?? 0)}\`, or remove the line`
      )
    ];
  }
  if (!outcome && heading !== -1) {
    return [
      finding(
        file,
        heading + 1,
        "## Outcome section has no frontmatter outcome line",
        "the outcome tool writes both; run `harness outcome record`, or remove the section"
      )
    ];
  }
  return [];
}
function checkIdea(file, markdown, ideas2) {
  const parsed = frontmatter2(file, markdown);
  if (!parsed) {
    return [
      finding(
        file,
        1,
        "frontmatter is missing",
        `start the file with --- and the idea fields (${IDEA_REQUIRED.join(", ")}) ---`
      )
    ];
  }
  const { keys } = parsed;
  const problems = [
    ...parsed.errors,
    ...valueProblems2(file, keys),
    ...parentProblems(file, keys, ideas2),
    ...outcomeProblems(file, markdown, keys)
  ];
  if (!IDEA_NAME.test(file)) {
    problems.push(
      finding(
        file,
        1,
        "idea file is not named NNNN-slug.md",
        "rename it to a four-digit number and a lowercase slug"
      )
    );
  }
  problems.sort((a, b) => a.line - b.line);
  for (const key of IDEA_REQUIRED.filter((name) => !keys.has(name))) {
    problems.push(
      finding(file, 1, `frontmatter ${key} is missing`, `add a ${key}: line`)
    );
  }
  return problems;
}

// src/kb/findings.ts
var INDEX3 = "docs/index.md";
var CLI = "tools/kore/src/cli/cli.ts";
var PLAN = /^infra\/plans\/[^/]+\.md$/;
var ADR2 = /^docs\/decisions\/[^/]+\.md$/;
var IDEA = /^docs\/ideas\/[^/]+\.md$/;
var SKILL = /^skills\/[^/]+\/SKILL\.md$/;
var MARKER2 = /^\s*(?:\/\/|#|\*|--|<!--)\s*(Docs|Plan|ADR):\s+([^\s#]+)(?:#(\S+))?/;
function openTree(deps) {
  const files = [...deps.files()].sort();
  const tracked = new Set(files);
  const anchorCache = /* @__PURE__ */ new Map();
  const anchorsOf = (path) => {
    let known = anchorCache.get(path);
    if (!known) {
      known = anchors(deps.read(path) ?? "");
      anchorCache.set(path, known);
    }
    return known;
  };
  return {
    deps,
    files,
    tracked,
    exists: (path) => tracked.has(path) || path === "." || files.some((file) => file.startsWith(`${path}/`)),
    anchorProblem(file, line2, label, target, anchor) {
      if (!target.endsWith(".md") || !tracked.has(target)) {
        return null;
      }
      const known = anchorsOf(target);
      if (known.includes(anchor.toLowerCase())) {
        return null;
      }
      return finding(
        file,
        line2,
        `${label} #${anchor} is not a heading in ${target}`,
        known.length ? `use one of its heading slugs, e.g. #${known[0]}` : "remove the anchor; the file has no headings"
      );
    }
  };
}
function ideaNumbers(files) {
  const ideas2 = /* @__PURE__ */ new Map();
  const problems = [];
  for (const file of files) {
    const number = IDEA_NAME.exec(file)?.[1];
    if (number === void 0) {
      continue;
    }
    const first = ideas2.get(number);
    if (first === void 0) {
      ideas2.set(number, file);
    } else {
      problems.push(
        finding(
          file,
          1,
          `idea number ${number} is also used by ${first}`,
          "renumber it to the next free number"
        )
      );
    }
  }
  return { ideas: ideas2, problems };
}
function linkProblems2(tree, file, text9) {
  const problems = [];
  for (const { line: line2, text: prose2 } of proseLines(text9)) {
    for (const [, raw = ""] of prose2.matchAll(LINK)) {
      if (isExternal(raw)) {
        continue;
      }
      const [pathPart = "", anchor] = raw.split("#", 2);
      const target = pathPart ? resolve7(file, decodeURI(pathPart)) : file;
      if (target === null || !tree.exists(target)) {
        problems.push(
          finding(
            file,
            line2,
            `link target ${target ?? pathPart} does not exist`,
            "point the link at an existing file or remove it"
          )
        );
        continue;
      }
      const problem = anchor ? tree.anchorProblem(file, line2, "link anchor", target, anchor) : null;
      if (problem) {
        problems.push(problem);
      }
    }
  }
  return problems;
}
function markdownProblems(tree, ideas2) {
  const problems = [];
  for (const file of tree.files.filter((name) => name.endsWith(".md"))) {
    const text9 = tree.deps.read(file);
    if (text9 === null) {
      continue;
    }
    problems.push(...linkProblems2(tree, file, text9));
    if (PLAN.test(file) || ADR2.test(file)) {
      problems.push(
        ...checkFrontmatter(file, text9, (path) => tree.exists(path))
      );
    } else if (IDEA.test(file)) {
      problems.push(...checkIdea(file, text9, ideas2));
    }
  }
  return problems;
}
function indexProblems(tree) {
  const index = tree.tracked.has(INDEX3) ? tree.deps.read(INDEX3) : null;
  if (index === null) {
    return [
      finding(
        INDEX3,
        1,
        "the knowledge index is missing",
        "create it with one entry per plan, ADR, and skill"
      )
    ];
  }
  const problems = [];
  const listed = /* @__PURE__ */ new Set();
  for (const { line: line2, text: text9 } of proseLines(index)) {
    if (!text9.startsWith("- [")) {
      continue;
    }
    const raw = /\]\(([^)\s#]+)/.exec(text9)?.[1];
    if (raw === void 0 || isExternal(raw)) {
      continue;
    }
    const target = resolve7(INDEX3, decodeURI(raw));
    if (target) {
      listed.add(target);
    }
    if (target === null || !tree.exists(target)) {
      problems.push(
        finding(
          INDEX3,
          line2,
          `index entry ${target ?? raw} names a missing file`,
          "remove the entry or restore the file"
        )
      );
    }
  }
  for (const file of tree.files) {
    const indexed = PLAN.test(file) || ADR2.test(file) || IDEA.test(file) || SKILL.test(file);
    if (indexed && !listed.has(file)) {
      problems.push(
        finding(
          INDEX3,
          1,
          `${file} is not in the index`,
          "add an entry under its ## heading"
        )
      );
    }
  }
  return problems;
}
var TRAILING = /[.,;:)]+$/;
function markerProblems(tree) {
  const problems = [];
  for (const file of tree.files.filter((name) => !name.endsWith(".md"))) {
    const text9 = tree.deps.read(file);
    if (text9 === null) {
      continue;
    }
    text9.split("\n").forEach((line2, position) => {
      const match = MARKER2.exec(line2);
      if (!match) {
        return;
      }
      const [, label = "", rawPath = "", anchor] = match;
      const path = rawPath.replace(TRAILING, "");
      if (!tree.exists(path)) {
        problems.push(
          finding(
            file,
            position + 1,
            `${label}: path ${path} does not exist`,
            "use a path from the repository root"
          )
        );
        return;
      }
      const problem = anchor ? tree.anchorProblem(
        file,
        position + 1,
        `${label}: anchor`,
        path,
        anchor.replace(TRAILING, "")
      ) : null;
      if (problem) {
        problems.push(problem);
      }
    });
  }
  return problems;
}
function readmeProblems(tree) {
  const cli = tree.tracked.has(CLI) ? tree.deps.read(CLI) : null;
  const readme = tree.tracked.has("README.md") ? tree.deps.read("README.md") : null;
  const problems = [];
  if (cli === null || readme === null) {
    return problems;
  }
  const seen = /* @__PURE__ */ new Set();
  let inUsage = false;
  cli.split("\n").forEach((line2, position) => {
    if (/^\s*Usage:\s*$/.test(line2)) {
      inUsage = true;
      return;
    }
    if (!inUsage) {
      return;
    }
    if (!line2.trim()) {
      inUsage = false;
      return;
    }
    const command = /^\s+kore\s+([a-z][\w-]*)/.exec(line2)?.[1];
    if (!command || seen.has(command)) {
      return;
    }
    seen.add(command);
    if (!new RegExp(`\\bkore(?: --)? ${command}\\b`).test(readme)) {
      problems.push(
        finding(
          CLI,
          position + 1,
          `kore ${command} is in the CLI usage text but README.md does not mention it`,
          "document it in README.md"
        )
      );
    }
  });
  return problems;
}
function findings(deps) {
  const tree = openTree(deps);
  const { ideas: ideas2, problems } = ideaNumbers(tree.files);
  return [
    ...problems,
    ...markdownProblems(tree, ideas2),
    ...indexProblems(tree),
    ...markerProblems(tree),
    ...readmeProblems(tree)
  ];
}

// src/kb/stale.ts
function dependenciesOf(deps) {
  const files = [...deps.files()].sort();
  const tracked = new Set(files);
  const dependencies = /* @__PURE__ */ new Map();
  const depend = (document, path) => {
    if (path === document || !tracked.has(path)) {
      return;
    }
    let paths = dependencies.get(document);
    if (!paths) {
      paths = /* @__PURE__ */ new Set();
      dependencies.set(document, paths);
    }
    paths.add(path);
  };
  for (const file of files) {
    const text9 = deps.read(file);
    if (text9 === null) {
      continue;
    }
    if (PLAN.test(file) || ADR2.test(file)) {
      for (const target of linkTargets(file, text9)) {
        depend(file, target);
      }
    }
    if (file.endsWith(".md")) {
      continue;
    }
    for (const line2 of text9.split("\n")) {
      const path = (MARKER2.exec(line2)?.[2] ?? "").replace(/[.,;:)]+$/, "");
      if (PLAN.test(path) || ADR2.test(path)) {
        depend(path, file);
      }
    }
  }
  return dependencies;
}
function linkTargets(file, text9) {
  const targets = [];
  for (const { text: prose2 } of proseLines(text9)) {
    for (const [, raw = ""] of prose2.matchAll(LINK)) {
      const [pathPart] = raw.split("#", 1);
      const target = isExternal(raw) || !pathPart ? null : resolve7(file, decodeURI(pathPart));
      if (target !== null) {
        targets.push(target);
      }
    }
  }
  return targets;
}
async function staleDocuments(deps) {
  const commitDate = deps.commitDate?.bind(deps);
  if (!commitDate) {
    return [];
  }
  const stale = [];
  for (const [document, paths] of dependenciesOf(deps)) {
    const verified = frontmatter2(document, deps.read(document) ?? "")?.keys.get(
      "last-verified"
    )?.value;
    if (!verified || !DATE.test(verified)) {
      continue;
    }
    let newest = null;
    for (const path of [...paths].sort()) {
      const date = await commitDate(path);
      if (date && (newest === null || date > newest.date)) {
        newest = { path, date };
      }
    }
    if (newest && newest.date > verified) {
      stale.push({ document, verified, ...newest });
    }
  }
  return stale.sort((a, b) => a.document.localeCompare(b.document));
}

// src/kb/report.ts
function format(problem) {
  return `${problem.file}:${problem.line}: ${problem.message}; ${problem.fix}`;
}
async function run(argv, deps, log) {
  const status2 = await runChecks(argv, deps, log);
  const audit3 = deps.audit?.bind(deps);
  if (!audit3) {
    return status2;
  }
  const failed = await printAudit(audit3, log);
  if (failed) {
    const strict = argv.includes("--strict");
    log(
      strict ? "kb-check: skill audit failed" : "kb-check: skill audit failed (warn mode; --strict fails on it)"
    );
    return strict ? 1 : status2;
  }
  return status2;
}
async function printAudit(audit3, log) {
  let report3;
  try {
    report3 = await audit3();
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    log(
      `skill audit: not run (${error.message}); run \`node skills/bin/harness.mjs skill audit\` to see the cause`
    );
    return true;
  }
  log("skill audit:");
  for (const line2 of report3.text.trimEnd().split("\n")) {
    log(`  ${line2}`.trimEnd());
  }
  return report3.failing;
}
async function runChecks(argv, deps, log) {
  const strict = argv.includes("--strict");
  const problems = findings(deps);
  for (const problem of problems) {
    log(format(problem));
  }
  const stale = await staleDocuments(deps);
  for (const item of stale) {
    log(
      `stale: ${item.document} was last verified ${item.verified}, but ${item.path} changed ${item.date}; re-read it and update last-verified`
    );
  }
  const flags = await deps.flagAudit?.() ?? [];
  for (const line2 of flags) {
    log(`flag: ${line2}`);
  }
  const staleNote = () => {
    if (stale.length > 0) {
      log(
        `kb-check: ${stale.length} stale ${stale.length === 1 ? "document" : "documents"} (warn only)`
      );
    }
    if (flags.length > 0) {
      log(
        `kb-check: ${flags.length} flag audit ${flags.length === 1 ? "warning" : "warnings"} (warn only)`
      );
    }
  };
  if (problems.length === 0) {
    if (stale.length === 0 && flags.length === 0) {
      log("kb-check: clean");
    } else {
      staleNote();
    }
    return 0;
  }
  const noun = problems.length === 1 ? "finding" : "findings";
  log(
    strict ? `kb-check: ${problems.length} ${noun}` : `kb-check: ${problems.length} ${noun} (warn mode; --strict fails on them)`
  );
  staleNote();
  return strict ? 1 : 0;
}

// src/skill/index.ts
import { join as join15 } from "node:path";

// src/skill/audit.ts
var DESCRIPTION_BUDGET = 200;
var BODY_BUDGET = 25;
function invalid(name, reason) {
  return {
    name,
    directory: name,
    descriptionChars: 0,
    bodyLines: 0,
    verdict: "invalid",
    reason
  };
}
function field(frontmatter3, key) {
  const line2 = frontmatter3.split("\n").find((l) => l.startsWith(`${key}:`));
  const value = line2?.slice(key.length + 1).trim();
  if (value === void 0 || value === "") {
    return void 0;
  }
  return value.replace(/^(["'])(.*)\1$/, "$2");
}
function overBudgets(descriptionChars, bodyLines) {
  const over = [];
  if (descriptionChars > DESCRIPTION_BUDGET) {
    over.push("description");
  }
  if (bodyLines > BODY_BUDGET) {
    over.push("body");
  }
  return over;
}
function countLines(body) {
  return body === "" ? 0 : body.replace(/\n$/, "").split("\n").length;
}
function auditSkill(directory, text9) {
  const source = text9.replaceAll("\r\n", "\n");
  if (!source.startsWith("---\n")) {
    return invalid(directory, "missing frontmatter");
  }
  const close3 = /\n---[ \t]*(\n|$)/.exec(source.slice(3));
  if (close3 === null) {
    return invalid(directory, "unterminated frontmatter");
  }
  const end = close3.index + 3;
  const frontmatter3 = source.slice(4, end);
  const name = field(frontmatter3, "name");
  if (name === void 0) {
    return invalid(directory, "missing name");
  }
  const description = field(frontmatter3, "description");
  if (description === void 0) {
    return invalid(directory, "missing description");
  }
  if (/^[>|][+-]?$/.test(description)) {
    return invalid(directory, "multi-line description");
  }
  const bodyLines = countLines(source.slice(end + close3[0].length));
  const over = overBudgets(description.length, bodyLines);
  const row = {
    name,
    directory,
    descriptionChars: description.length,
    bodyLines,
    verdict: over.length > 0 ? "over-budget" : "ok"
  };
  return over.length > 0 ? { ...row, over } : row;
}
async function auditSkills(fs, skillsDir) {
  const rows = [];
  for (const directory of await fs.readdir(skillsDir)) {
    const path = `${skillsDir}/${directory}/SKILL.md`;
    if (await fs.exists(path)) {
      rows.push(auditSkill(directory, await fs.readFile(path)));
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "en"));
  const summary = {
    ok: 0,
    "over-budget": 0,
    invalid: 0
  };
  for (const row of rows) {
    summary[row.verdict] += 1;
  }
  return { skills: rows, summary };
}
function detail(row) {
  if (row.verdict === "over-budget") {
    return ` (${(row.over ?? []).join(", ")})`;
  }
  return row.verdict === "invalid" ? ` (${row.reason ?? ""})` : "";
}
function renderReport(report3) {
  const width = Math.max(4, ...report3.skills.map((s) => s.name.length));
  const lines2 = [
    `${"NAME".padEnd(width)}  DESC  BODY  VERDICT`,
    ...report3.skills.map(
      (s) => `${s.name.padEnd(width)}  ${String(s.descriptionChars).padStart(4)}  ${String(s.bodyLines).padStart(4)}  ${s.verdict}${detail(s)}`
    ),
    "",
    `${report3.summary.ok} ok, ${report3.summary["over-budget"]} over-budget, ${report3.summary.invalid} invalid`
  ];
  return `${lines2.join("\n")}
`;
}

// src/skill/index.ts
var SKILLS_DIR = "skills";
async function skillReport(fs, root3) {
  const skillsDir = join15(root3, SKILLS_DIR);
  try {
    return await auditSkills(fs, skillsDir);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new CommandError(
        `No skills directory at ${skillsDir}. Run from the repository, or set CLAUDE_PROJECT_DIR to its root.`
      );
    }
    throw error;
  }
}
var isFailing = (report3) => report3.summary["over-budget"] + report3.summary.invalid > 0;
async function skillAudit(fs, root3) {
  const report3 = await skillReport(fs, root3);
  return { text: renderReport(report3), failing: isFailing(report3) };
}
var audit2 = {
  summary: "report each skill's description and body against its budgets",
  options: { strict: "boolean" },
  async run({ json, options, deps }) {
    const report3 = await skillReport(deps.fs, await deps.root());
    deps.stdout(json ? `${JSON.stringify(report3)}
` : renderReport(report3));
    return options["strict"] === true && isFailing(report3) ? 1 : 0;
  }
};
var skill = { audit: audit2 };

// src/hook/kb-check.ts
var ENOENT = "ENOENT";
var EISDIR = "EISDIR";
async function git2(deps, root3, args) {
  const result = await deps.runner.run("git", args, { cwd: root3 });
  if (result.code !== 0) {
    throw new CommandError(
      `git ${args.join(" ")} failed: ${result.stderr.trim()}`
    );
  }
  return result.stdout;
}
var reasonOf = (error) => (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";
async function flagAudit(deps, root3) {
  try {
    const unproven = await unprovenFlags(deps.fs, deps.clock, root3);
    return unproven.map(unprovenLine);
  } catch (error) {
    if (error instanceof FlagError) {
      return error.message.trim().split("\n");
    }
    return [
      `flag audit could not run (${reasonOf(error)}); run \`node skills/bin/harness.mjs flag audit\` to see the cause`
    ];
  }
}
async function readTree(deps, root3) {
  const listed = await git2(deps, root3, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z"
  ]);
  const tree = /* @__PURE__ */ new Map();
  for (const path of listed.split("\0").filter(Boolean)) {
    try {
      tree.set(path, await deps.fs.readFile(`${root3}/${path}`));
    } catch (error) {
      const code = error.code;
      if (code !== ENOENT && code !== EISDIR) {
        throw error;
      }
    }
  }
  return tree;
}
async function kbCheck(strict, deps) {
  const root3 = await deps.root();
  const tree = await readTree(deps, root3);
  const lines2 = [];
  const kbDeps = {
    files: () => [...tree.keys()],
    read: (path) => tree.get(path) ?? null,
    commitDate: async (path) => (await git2(deps, root3, ["log", "-1", "--format=%cs", "--", path])).trim() || null,
    audit: () => skillAudit(deps.fs, root3),
    flagAudit: () => flagAudit(deps, root3)
  };
  const code = await run(
    strict ? ["--strict"] : [],
    kbDeps,
    (line2) => lines2.push(line2)
  );
  return { code, stdout: lines2.map((line2) => `${line2}
`).join("") };
}

// src/hook/repository-checks.ts
var skillLinks = hookCommand(
  "skill-links",
  "report skills a harness directory does not link by relative path",
  async ({ deps }) => {
    const problems = await linkProblems(deps.fs, await deps.root());
    return problems.length === 0 ? {} : { code: 1, stderr: `${problems.join("\n")}
` };
  }
);
var workflowPermissions = hookCommand(
  "workflow-permissions",
  "report workflows whose token permissions break the signer guard",
  async ({ deps }) => {
    const problems = await workflowProblems(deps.fs, await deps.root());
    return problems.length === 0 ? {} : { code: 1, stderr: `${problems.join("\n")}
` };
  }
);
var kbCheckHook = hookCommand(
  "kb-check",
  "report knowledge-base problems: links, the index, frontmatter, markers and README coverage; --strict exits 1 on findings",
  ({ deps, options }) => kbCheck(options["strict"] === true, deps),
  { payload: false, faultCode: 1 }
);

// src/hook/index.ts
var feedbackHook = hookCommand(
  "feedback",
  "run the post-edit, stop or tool-failure feedback checks and record ledger events",
  ({ deps, payload, operand }) => feedback(operand, payload, deps),
  { operand: "mode" }
);
var guardHook = hookCommand(
  "guard",
  "block or warn on tool calls that break mechanically checkable rules (PreToolUse)",
  ({ deps, payload }) => guard(payload, deps),
  { faultCode: 1 }
);
var hook = {
  context,
  delta,
  feedback: feedbackHook,
  guard: guardHook,
  "kb-check": kbCheckHook,
  record: record3,
  "retro-scan": retroScan,
  "skill-links": skillLinks,
  statusline,
  "workflow-permissions": workflowPermissions
};

// src/session/equalize.ts
var byY = (a, b) => a.rect.y - b.rect.y;
function describeFailure(result) {
  return (result.stderr || result.stdout).trim() || `exit code ${result.code}`;
}
async function readLayout(runner, callerPane) {
  const result = await runner.run("herdr", [
    "pane",
    "layout",
    "--pane",
    callerPane
  ]);
  if (result.code !== 0) {
    return {
      error: `herdr pane layout failed: ${describeFailure(result)}`
    };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    const layout = parsed.result?.layout;
    if (layout !== void 0) {
      return { layout };
    }
  } catch {
  }
  return {
    error: `herdr pane layout returned no layout (.result.layout): ${result.stdout.trim()}`
  };
}
function spawnedColumn(layout, callerPane) {
  const caller = layout.panes.find((p) => p.pane_id === callerPane);
  const column = Math.max(...layout.panes.map((p) => p.rect.x));
  if (caller === void 0 || column <= caller.rect.x) {
    return [];
  }
  return layout.panes.filter((p) => p.rect.x === column).sort(byY);
}
async function equalize(runner, callerPane) {
  const read = await readLayout(runner, callerPane);
  if ("error" in read) {
    return { status: "failed", reason: read.error };
  }
  const { layout } = read;
  const panes = spawnedColumn(layout, callerPane);
  const column = panes[0]?.rect.x;
  if (column === void 0) {
    return {
      status: "skipped",
      reason: "no spawned column right of the caller"
    };
  }
  const splits = layout.splits.filter((s) => s.direction === "down" && s.rect.x === column).sort(byY);
  if (splits.length !== panes.length - 1) {
    return {
      status: "skipped",
      reason: "layout splits do not match the spawned panes"
    };
  }
  for (const [i, split] of splits.entries()) {
    const delta2 = 1 / (panes.length - i) - split.ratio;
    if (Math.abs(delta2) <= 5e-4) {
      continue;
    }
    const [pane, direction] = delta2 < 0 ? [panes[i + 1], "up"] : [panes[i], "down"];
    const resize = await runner.run("herdr", [
      "pane",
      "resize",
      "--pane",
      pane.pane_id,
      "--direction",
      direction,
      "--amount",
      Math.abs(delta2).toFixed(6)
    ]);
    if (resize.code !== 0) {
      return {
        status: "failed",
        reason: `herdr pane resize failed: ${describeFailure(resize)}`
      };
    }
  }
  return { status: "equalized" };
}

// src/session/names.ts
var MAX_LENGTH = 32;
var ORDINALS = /* @__PURE__ */ new Set([
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth"
]);
var EXAMPLE = "name it for its subject, such as image-trust-reader";
function isPlaceholderSegment(segment) {
  return /^[a-z]$/.test(segment) || /^\d{1,2}$/.test(segment) || /^step\d+$/.test(segment) || /^\d+(st|nd|rd|th)$/.test(segment) || ORDINALS.has(segment);
}
function sessionNameError(name) {
  if (!/^[a-z0-9_-]+$/.test(name)) {
    return `Session name "${name}" must use only lowercase letters, digits, "-" and "_"; ${EXAMPLE}.`;
  }
  if (name.length > MAX_LENGTH) {
    return `Session name "${name}" is ${name.length} characters, but Herdr allows at most ${MAX_LENGTH}; shorten it, for example by dropping the role suffix.`;
  }
  if (name.split(/[-_]/).some(isPlaceholderSegment)) {
    return `Session name "${name}" uses a letter, ordinal or step number; ${EXAMPLE}.`;
  }
  return void 0;
}

// src/session/output.ts
var USAGE_ERROR = 2;
var FAILED5 = 1;
function fail3(deps, json, code, message) {
  deps.stderr(
    `${json ? `${JSON.stringify({ error: message })}
` : ""}${message}
`
  );
  return code;
}

// src/session/registry.ts
import { join as join16, resolve as resolve8 } from "node:path";
var STATE_DIR = ".kore/state/sessions";
function isRecord(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record4 = value;
  return typeof record4.name === "string" && typeof record4.paneId === "string" && typeof record4.callerPane === "string" && typeof record4.model === "string";
}
var SessionRegistry = class _SessionRegistry {
  constructor(fs, dir) {
    this.fs = fs;
    this.dir = dir;
  }
  fs;
  dir;
  /** Keeps state in the main checkout, shared by every worktree (see `mainRoot`). */
  static async open(deps) {
    const main = await mainRoot(deps);
    if (main === void 0) {
      throw new CommandError(
        "Cannot find the main checkout to keep session state in. Run inside the repository or set KORE_ROOT to its root."
      );
    }
    return new _SessionRegistry(deps.fs, resolve8(main, STATE_DIR));
  }
  file(name) {
    return join16(this.dir, `${name}.json`);
  }
  async read(name) {
    const path = this.file(name);
    if (!await this.fs.exists(path)) {
      return void 0;
    }
    let parsed;
    try {
      parsed = JSON.parse(await this.fs.readFile(path));
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      parsed = void 0;
    }
    if (!isRecord(parsed)) {
      throw new CommandError(
        `Session state ${path} is not a valid session record; delete it and spawn the session again.`
      );
    }
    return parsed;
  }
  async write(record4) {
    await this.fs.writeFile(
      this.file(record4.name),
      `${JSON.stringify(record4, null, 2)}
`
    );
  }
  /** Why `name` cannot be spawned again: its record exists and is not closed. Undefined when free. */
  async unavailable(name) {
    const existing = await this.read(name);
    return existing === void 0 || existing.closedAt !== void 0 ? void 0 : `A session record for ${name} (pane ${existing.paneId}) already exists and is not closed; run \`session wait ${name}\` then \`session close ${name}\`, or pick another name. No pane was split.`;
  }
  /** Records a new session; refuses to replace one that is not closed, even under a race. */
  async create(record4) {
    const content = `${JSON.stringify(record4, null, 2)}
`;
    try {
      await this.fs.createFile(this.file(record4.name), content);
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      const reason = await this.unavailable(record4.name);
      if (reason !== void 0) {
        throw new CommandError(
          reason.replace(
            " No pane was split.",
            ` Pane ${record4.paneId} is running unrecorded; close it with \`herdr pane close ${record4.paneId}\`.`
          )
        );
      }
      await this.write(record4);
    }
  }
};

// src/session/worktree.ts
import { join as join17 } from "node:path";
var removeCommands = (worktree) => `\`git worktree remove ${worktree.path}\` and \`git branch -D ${worktree.branch}\``;
var removeHint = (worktree) => `The worktree ${worktree.path} was left behind; remove it with ${removeCommands(worktree)}.`;
var closeHint = (worktree) => `Remove its worktree once its branch is merged: ${removeCommands(worktree)}.`;
async function create2(deps, name, branch) {
  const main = await mainRoot(deps);
  if (main === void 0) {
    return {
      error: "Cannot find the main checkout to create the worktree in. Run inside the repository or set KORE_ROOT to its root. No pane was split."
    };
  }
  const worktree = { path: join17(main, ".claude", "worktrees", name), branch };
  const add = await deps.runner.run(
    "git",
    ["worktree", "add", "-b", branch, worktree.path, "HEAD"],
    { cwd: deps.cwd }
  );
  if (add.code !== 0) {
    return {
      error: `git worktree add failed: ${describeFailure(add)}. No pane was split. A previous spawn may have left the worktree or branch: run ${removeCommands(worktree)}, or pass --branch <other>.`
    };
  }
  const install = await deps.runner.run("npm", ["ci"], {
    cwd: join17(worktree.path, "tools", "kore")
  });
  if (install.code !== 0) {
    return {
      error: `npm ci failed in the new worktree: ${describeFailure(install)}. No pane was split. ${removeHint(worktree)}`
    };
  }
  return worktree;
}
async function place(deps, options, name) {
  if (options.worktree !== true) {
    return { cwd: deps.cwd, left: "" };
  }
  const branch = typeof options.branch === "string" ? options.branch : name;
  const worktree = await create2(deps, name, branch);
  if ("error" in worktree) {
    return worktree;
  }
  return { worktree, cwd: worktree.path, left: ` ${removeHint(worktree)}` };
}

// src/session/close.ts
var NOT_IN_HERDR = "Not inside Herdr (HERDR_ENV is not 1 or HERDR_PANE_ID is unset). Run this from the Herdr pane that spawned the session.";
function refuse(record4, callerPane) {
  const { name, paneId } = record4;
  if (record4.closedAt !== void 0) {
    return `Session ${name} is already closed (pane ${paneId}).`;
  }
  if (record4.callerPane !== callerPane) {
    return `Session ${name} was spawned from pane ${record4.callerPane}, not ${callerPane}; only that pane may close it.`;
  }
  return record4.result === void 0 ? `Session ${name} has no recorded result, so pane ${paneId} stays open. Run \`session wait ${name}\` first.` : void 0;
}
async function finishClose({ json, deps }, registry, record4, callerPane) {
  const { name } = record4;
  await registry.write({ ...record4, closedAt: deps.clock.now().toISOString() });
  const equalized = await equalize(deps.runner, callerPane);
  const note = equalized.status === "failed" ? `Closed, but equalizing failed: ${equalized.reason}` : void 0;
  if (note !== void 0) {
    deps.stderr(`${note}
`);
  }
  const hint = record4.worktree === void 0 ? void 0 : closeHint(record4.worktree);
  deps.stdout(
    json ? `${JSON.stringify({ name, paneId: record4.paneId, closed: true, equalize: equalized, ...hint === void 0 ? {} : { hint } })}
` : `Closed ${name} (pane ${record4.paneId}).${hint === void 0 ? "" : ` ${hint}`}
`
  );
  return 0;
}
async function close2(context2) {
  const { json, deps } = context2;
  const name = context2.operand;
  if (name === void 0) {
    return fail3(
      deps,
      json,
      USAGE_ERROR,
      "Missing the session name: session close <name>."
    );
  }
  const nameError = sessionNameError(name);
  if (nameError !== void 0) {
    return fail3(deps, json, USAGE_ERROR, nameError);
  }
  const callerPane = deps.env.HERDR_PANE_ID;
  if (deps.env.HERDR_ENV !== "1" || !callerPane) {
    return fail3(deps, json, FAILED5, NOT_IN_HERDR);
  }
  const registry = await SessionRegistry.open(deps);
  const record4 = await registry.read(name);
  if (record4 === void 0) {
    return fail3(
      deps,
      json,
      FAILED5,
      `This tool did not create a session named ${name}, so it will not close one. Close it yourself with \`herdr pane close <pane-id>\` if you are sure.`
    );
  }
  const refusal = refuse(record4, callerPane);
  if (refusal !== void 0) {
    return fail3(deps, json, FAILED5, refusal);
  }
  const closed = await deps.runner.run("herdr", [
    "pane",
    "close",
    record4.paneId
  ]);
  if (closed.code !== 0) {
    return fail3(
      deps,
      json,
      FAILED5,
      `herdr pane close ${record4.paneId} failed: ${describeFailure(closed)}`
    );
  }
  return await finishClose(context2, registry, record4, callerPane);
}

// src/session/models.ts
var MODELS = {
  "claude-fable-5-2": {
    name: "Fable 5.2",
    pattern: /(?<![\w.])Fable 5\.2(?![\w.])/
  },
  "claude-opus-5-5": {
    name: "Opus 5.5",
    pattern: /(?<![\w.])Opus 5\.5(?![\w.])/
  },
  "claude-sonnet-5-5": {
    name: "Sonnet 5.5",
    pattern: /(?<![\w.])Sonnet 5\.5(?![\w.])/
  },
  "claude-haiku-5-5": {
    name: "Haiku 5.5",
    pattern: /(?<![\w.])Haiku 5\.5(?![\w.])/
  }
};
function displayName(model) {
  return Object.hasOwn(MODELS, model) ? MODELS[model]?.name : void 0;
}
function modelOnScreen(model, screen) {
  const expected = Object.hasOwn(MODELS, model) ? MODELS[model] : void 0;
  if (expected?.pattern.test(screen) === true) {
    return { status: "verified" };
  }
  const seen = Object.values(MODELS).find(
    ({ pattern }) => pattern.test(screen)
  );
  return seen === void 0 ? { status: "none" } : { status: "mismatch", seen: seen.name };
}

// src/session/agent-start.ts
var BUSY_BOUND_MS = 1e4;
var MODEL_BOUND_MS = 5e3;
var RETRY_MS = 500;
async function startAgent(deps, args) {
  const deadline = deps.clock.now().getTime() + BUSY_BOUND_MS;
  for (; ; ) {
    const start = await deps.runner.run("herdr", args);
    if (start.code === 0) {
      return void 0;
    }
    if (!`${start.stdout}${start.stderr}`.includes("agent_pane_busy")) {
      return `herdr agent start failed: ${describeFailure(start)}`;
    }
    if (deps.clock.now().getTime() >= deadline) {
      return `herdr agent start failed: agent_pane_busy for ${BUSY_BOUND_MS / 1e3} seconds; the pane's shell never became ready (${describeFailure(start)})`;
    }
    await deps.clock.sleep(RETRY_MS);
  }
}
async function checkModel(deps, name, model) {
  const expected = displayName(model);
  if (expected === void 0) {
    return {
      status: "unverified",
      reason: `No display name is known for ${model}, so the pane's model could not be confirmed.`
    };
  }
  const deadline = deps.clock.now().getTime() + MODEL_BOUND_MS;
  for (; ; ) {
    const read = await deps.runner.run("herdr", [
      "agent",
      "read",
      name,
      "--source",
      "visible"
    ]);
    const seen = modelOnScreen(model, read.code === 0 ? read.stdout : "");
    if (seen.status === "verified") {
      return { status: "verified" };
    }
    if (seen.status === "mismatch") {
      return {
        mismatch: `Session ${name} runs "${seen.seen}" but ${model} ("${expected}") was requested.`
      };
    }
    if (deps.clock.now().getTime() >= deadline) {
      return {
        status: "unverified",
        reason: `The pane showed no model name, such as "${expected}", within ${MODEL_BOUND_MS / 1e3} seconds, so ${model} could not be confirmed.`
      };
    }
    await deps.clock.sleep(RETRY_MS);
  }
}

// src/session/brief.ts
function broadcastCommand(name, callerPane) {
  return `herdr pane send-text ${callerPane} "[herdr:${name}] finished: RESULT <done|blocked>; summary in pane $HERDR_PANE_ID" && herdr pane send-keys ${callerPane} enter`;
}
function buildBrief({ task, name, callerPane }) {
  return [
    task,
    "",
    `You are ${name}; your session name is ${name}.`,
    `When you finish, broadcast to pane \`${callerPane}\`. Print your summary and a final line with the word RESULT, a colon, then done or blocked. Then, as your very last action, run this one line with the outcome word (done or blocked) in place of <done|blocked>; it expands your own $HERDR_PANE_ID, and must carry no secrets or output beyond the outcome word:`,
    "",
    broadcastCommand(name, callerPane)
  ].join("\n");
}

// src/session/launch.ts
async function launch(deps, { role, model, effort, name, brief: brief2, paneId, callerPane, leftOpen }) {
  const started = await startAgent(deps, [
    "agent",
    "start",
    name,
    "--kind",
    "claude",
    "--pane",
    paneId,
    "--",
    "--agent",
    role,
    "--model",
    model,
    "--effort",
    effort
  ]);
  if (started !== void 0) {
    return { error: `${started}. ${leftOpen}` };
  }
  const checked = await checkModel(deps, name, model);
  if ("mismatch" in checked) {
    return { error: `${checked.mismatch} ${leftOpen}` };
  }
  const prompt = await deps.runner.run("herdr", [
    "agent",
    "prompt",
    name,
    buildBrief({ task: brief2, name, callerPane }),
    "--wait",
    "--until",
    "working",
    "--timeout",
    "5000"
  ]);
  if (prompt.code === 0) {
    return checked;
  }
  await deps.runner.run("herdr", ["agent", "send-keys", name, "enter"]);
  const retried = await deps.runner.run("herdr", [
    "agent",
    "wait",
    name,
    "--until",
    "working",
    "--timeout",
    "5000"
  ]);
  return retried.code === 0 ? checked : {
    error: `herdr agent prompt failed: ${describeFailure(prompt)}; pressing enter did not start it either: ${describeFailure(retried)}. Session ${name} is running in pane ${paneId} without its brief.`
  };
}

// src/session/agent-definition.ts
import { join as join18 } from "node:path";
var FRONTMATTER2 = /^---\n([\s\S]*?)\n---/;
function field2(frontmatter3, key) {
  const line2 = frontmatter3.split("\n").find((l) => l.startsWith(`${key}:`));
  const value = line2?.slice(key.length + 1).trim();
  return value === void 0 || value === "" ? void 0 : value.replace(/^(["'])(.*)\1$/, "$2");
}
function parseDefinition(markdown) {
  const frontmatter3 = FRONTMATTER2.exec(markdown)?.[1] ?? "";
  const model = field2(frontmatter3, "model");
  const effort = field2(frontmatter3, "effort");
  const tools = field2(frontmatter3, "tools");
  return {
    ...model === void 0 ? {} : { model },
    ...effort === void 0 ? {} : { effort },
    ...tools === void 0 ? {} : { tools: tools.split(",").map((tool) => tool.trim()) }
  };
}
var ROLE = /^[a-z][a-z0-9-]*$/;
async function readTier(deps, role) {
  if (!ROLE.test(role)) {
    return {};
  }
  const path = join18(await deps.root(), ".claude/agents", `${role}.md`);
  try {
    return parseDefinition(await deps.fs.readFile(path));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}
async function resolveTier(deps, role, flags) {
  const declared = await readTier(deps, role);
  const model = flags.model ?? declared.model;
  const effort = flags.effort ?? declared.effort;
  for (const [flag, value] of [
    ["model", model],
    ["effort", effort]
  ]) {
    if (value === void 0) {
      return {
        error: `Missing --${flag}, and .claude/agents/${role}.md does not declare it. Pass --${flag} or add \`${flag}:\` to that definition's frontmatter.`
      };
    }
  }
  return { model, effort };
}

// src/session/wait.ts
var DEFAULT_TIMEOUT_MS = 60 * 60 * 1e3;
var POLL_MS = 2e3;
var MARKER3 = /^[ \t]*(?:[●⏺][ \t]+)?RESULT: (done|blocked)[ \t\r]*$/gm;
function findResult(text9) {
  const last = [...text9.matchAll(MARKER3)].at(-1)?.[1];
  return last === "done" || last === "blocked" ? last : void 0;
}
function parseTimeout(value) {
  if (value === void 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  const ms = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(ms) && ms > 0 ? ms : { error: "--timeout must be a positive whole number of milliseconds." };
}
function seconds2(ms) {
  return `${ms / 1e3} seconds`;
}
async function waitForResult(deps, registry, record4, timeoutMs) {
  const done = (outcome) => ({
    name: record4.name,
    paneId: record4.paneId,
    model: record4.model,
    outcome,
    summary: `pane ${record4.paneId}`
  });
  if (record4.result !== void 0) {
    return done(record4.result.outcome);
  }
  const deadline = deps.clock.now().getTime() + timeoutMs;
  for (; ; ) {
    const read = await deps.runner.run("herdr", [
      "pane",
      "read",
      record4.paneId,
      "--source",
      "recent-unwrapped"
    ]);
    if (read.code !== 0) {
      return {
        error: `herdr pane read ${record4.paneId} failed: ${describeFailure(read)}`
      };
    }
    const outcome = findResult(read.stdout);
    if (outcome !== void 0) {
      await registry.write({
        ...record4,
        result: { outcome, at: deps.clock.now().toISOString() }
      });
      return done(outcome);
    }
    if (deps.clock.now().getTime() + POLL_MS > deadline) {
      return {
        error: `Session ${record4.name} printed no "RESULT: done" or "RESULT: blocked" line in pane ${record4.paneId} within ${seconds2(timeoutMs)}. It may still be working; run \`session wait ${record4.name}\` again or read the pane.`
      };
    }
    await deps.clock.sleep(POLL_MS);
  }
}
function formatWait(result) {
  return `${result.name} (${result.model}) finished: RESULT ${result.outcome}; summary in ${result.summary}.
`;
}
async function wait(context2) {
  const { json, deps, options } = context2;
  const name = context2.operand;
  if (name === void 0) {
    return fail3(
      deps,
      json,
      USAGE_ERROR,
      "Missing the session name: session wait <name>."
    );
  }
  const nameError = sessionNameError(name);
  if (nameError !== void 0) {
    return fail3(deps, json, USAGE_ERROR, nameError);
  }
  const timeout = parseTimeout(options.timeout);
  if (typeof timeout !== "number") {
    return fail3(deps, json, USAGE_ERROR, timeout.error);
  }
  const registry = await SessionRegistry.open(deps);
  const record4 = await registry.read(name);
  if (record4 === void 0) {
    return fail3(
      deps,
      json,
      FAILED5,
      `No session named ${name} was spawned by this tool; start it with \`session spawn\`.`
    );
  }
  const result = await waitForResult(deps, registry, record4, timeout);
  if ("error" in result) {
    return fail3(deps, json, FAILED5, result.error);
  }
  deps.stdout(json ? `${JSON.stringify(result)}
` : formatWait(result));
  return 0;
}

// src/session/spawn-check.ts
var REQUIRED3 = ["role", "name", "brief"];
function herdrCaller(deps) {
  const callerPane = deps.env.HERDR_PANE_ID;
  if (deps.env.HERDR_ENV !== "1") {
    return {
      error: "Not inside Herdr (HERDR_ENV is not 1). Run this from a Herdr pane; no session was started.",
      code: FAILED5
    };
  }
  if (callerPane === void 0 || callerPane === "") {
    return {
      error: "HERDR_PANE_ID is not set, so the session cannot broadcast back. Run this from a Herdr pane.",
      code: FAILED5
    };
  }
  return callerPane;
}
function worktreeError(role, options) {
  if (options.branch !== void 0 && options.worktree !== true) {
    return "--branch only applies with --worktree.";
  }
  return role === "writer" && options.worktree !== true ? "A writer needs its own worktree so concurrent writers cannot collide. Add --worktree." : void 0;
}
async function check({
  deps,
  options
}) {
  const usage2 = (error) => ({ error, code: USAGE_ERROR });
  const missing = REQUIRED3.find((flag2) => typeof options[flag2] !== "string");
  if (missing !== void 0) {
    return usage2(`Missing --${missing}.`);
  }
  const given = options;
  const nameError = sessionNameError(given.name);
  if (nameError !== void 0) {
    return usage2(nameError);
  }
  if (findResult(given.brief) !== void 0) {
    return usage2(
      'The brief has a line that is only a RESULT marker, which would end the wait early. Describe the marker in words instead, such as "end with the word RESULT, a colon, then done or blocked".'
    );
  }
  const wrongWorktree = worktreeError(given.role, options);
  if (wrongWorktree !== void 0) {
    return usage2(wrongWorktree);
  }
  const timeoutMs = parseTimeout(options.timeout);
  if (typeof timeoutMs !== "number") {
    return usage2(timeoutMs.error);
  }
  const callerPane = herdrCaller(deps);
  if (typeof callerPane !== "string") {
    return callerPane;
  }
  const flag = (name) => typeof options[name] === "string" ? options[name] : void 0;
  const tier2 = await resolveTier(deps, given.role, {
    model: flag("model"),
    effort: flag("effort")
  });
  if ("error" in tier2) {
    return usage2(tier2.error);
  }
  return { values: { ...given, ...tier2 }, callerPane, timeoutMs };
}

// src/session/spawn-finish.ts
import { join as join19 } from "node:path";
async function recordLaunch(deps, record4) {
  try {
    const main = await mainRoot(deps);
    if (main === void 0) {
      return;
    }
    await new Ledger(
      deps.fs,
      deps.clock,
      deps.ids,
      join19(main, DEFAULT_LEDGER)
    ).record({
      source: "herdr",
      kind: "session.launch",
      occurredAt: record4.createdAt,
      pane: record4.paneId,
      agent: record4.name,
      role: record4.role,
      tier: record4.model
    });
  } catch {
  }
}
async function finish2({ json, deps, options }, { registry, record: record4, modelCheck, timeoutMs }) {
  const { name, paneId, callerPane, model, role, effort, worktree } = record4;
  const extra = worktree === void 0 ? {} : { worktree };
  await registry.create(record4);
  await recordLaunch(deps, record4);
  const verdict = modelCheck.status === "verified" ? "model verified" : `model unverified: ${modelCheck.reason}`;
  if (options["no-wait"] === true) {
    deps.stdout(
      json ? `${JSON.stringify({ name, paneId, model, role, effort, ...extra, modelCheck })}
` : `Spawned ${name} (${model}; ${verdict}) in pane ${paneId}; it will broadcast to ${callerPane} when it finishes. Collect its result with \`session wait ${name}\`.
`
    );
    return 0;
  }
  const result = await waitForResult(deps, registry, record4, timeoutMs);
  if ("error" in result) {
    return fail3(deps, json, FAILED5, result.error);
  }
  deps.stdout(
    json ? `${JSON.stringify({ ...result, role, effort, ...extra, modelCheck })}
` : `${formatWait(result).trimEnd()} (${verdict}).
`
  );
  return 0;
}

// src/session/spawn.ts
function paneIdOf(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    const id = parsed.result?.pane?.pane_id;
    return typeof id === "string" ? id : void 0;
  } catch {
    return void 0;
  }
}
async function splitPane(deps, callerPane, cwd) {
  const read = await readLayout(deps.runner, callerPane);
  if ("error" in read) {
    return { error: `${read.error}. No pane was split.` };
  }
  const last = spawnedColumn(read.layout, callerPane).at(-1);
  const where = last === void 0 ? ["--current", "--direction", "right"] : [last.pane_id, "--direction", "down"];
  const split = await deps.runner.run("herdr", [
    "pane",
    "split",
    ...where,
    "--cwd",
    cwd,
    "--no-focus"
  ]);
  if (split.code !== 0) {
    return { error: `herdr pane split failed: ${describeFailure(split)}` };
  }
  const paneId = paneIdOf(split.stdout);
  return paneId ?? {
    error: `herdr pane split did not return a pane id (.result.pane.pane_id): ${split.stdout.trim()}`
  };
}
async function nameTakenError(deps, name) {
  const found = await deps.runner.run("herdr", ["agent", "get", name]);
  if (found.code === 0) {
    return `A session named ${name} already exists; pick another name or close that session first. No pane was split.`;
  }
  if (`${found.stdout}${found.stderr}`.includes("agent_not_found")) {
    return void 0;
  }
  return `herdr agent get failed: ${describeFailure(found)}. No pane was split.`;
}
async function spawn2(context2) {
  const { json, deps } = context2;
  const checked = await check(context2);
  if ("error" in checked) {
    return fail3(deps, json, checked.code, checked.error);
  }
  const { name, model, role, effort } = checked.values;
  const { callerPane } = checked;
  const registry = await SessionRegistry.open(deps);
  const taken = await registry.unavailable(name) ?? await nameTakenError(deps, name);
  if (taken !== void 0) {
    return fail3(deps, json, FAILED5, taken);
  }
  const placed = await place(deps, context2.options, name);
  if ("error" in placed) {
    return fail3(deps, json, FAILED5, placed.error);
  }
  const paneId = await splitPane(deps, callerPane, placed.cwd);
  if (typeof paneId !== "string") {
    return fail3(deps, json, FAILED5, `${paneId.error}${placed.left}`);
  }
  const leftOpen = `The pane ${paneId} was left open; close it with \`herdr pane close ${paneId}\`.${placed.left}`;
  const equalized = await equalize(deps.runner, callerPane);
  if (equalized.status === "failed") {
    return fail3(deps, json, FAILED5, `${equalized.reason}. ${leftOpen}`);
  }
  const modelCheck = await launch(deps, {
    ...checked.values,
    paneId,
    callerPane,
    leftOpen
  });
  if ("error" in modelCheck) {
    return fail3(deps, json, FAILED5, modelCheck.error);
  }
  return await finish2(context2, {
    registry,
    modelCheck,
    record: {
      name,
      paneId,
      callerPane,
      model,
      role,
      effort,
      ...placed.worktree === void 0 ? {} : { worktree: placed.worktree },
      createdAt: deps.clock.now().toISOString()
    },
    timeoutMs: checked.timeoutMs
  });
}

// src/session/tier.ts
async function tier({
  json,
  deps,
  operand
}) {
  if (operand === void 0 || operand === "") {
    return fail3(
      deps,
      json,
      USAGE_ERROR,
      "Missing the role: run `session tier <role>`."
    );
  }
  const found = await resolveTier(deps, operand, {});
  if ("error" in found) {
    return fail3(deps, json, USAGE_ERROR, found.error);
  }
  deps.stdout(
    json ? `${JSON.stringify({ role: operand, ...found })}
` : `${operand}: ${found.model}, effort ${found.effort}
`
  );
  return 0;
}

// src/session/index.ts
var spawnCommand = {
  summary: "start a Claude session in a Herdr pane (--role --name --brief [--model --effort, default from .claude/agents/<role>.md] --timeout ms; --worktree [--branch b] runs it in a new git worktree under .claude/worktrees); it waits for the result unless --no-wait, the normal pattern: spawn with --no-wait, then run `session wait <name>` in the background",
  options: {
    role: "string",
    model: "string",
    effort: "string",
    name: "string",
    brief: "string",
    "no-wait": "boolean",
    worktree: "boolean",
    branch: "string",
    timeout: "string"
  },
  run: spawn2
};
var waitCommand = {
  summary: "wait for a spawned session's RESULT line and print its outcome (<name> --timeout ms)",
  operand: "name",
  options: { timeout: "string" },
  run: wait
};
var closeCommand = {
  summary: "close a spawned pane once its result is recorded (<name>; only the pane that spawned it)",
  operand: "name",
  run: close2
};
var tierCommand = {
  summary: "print the model and effort a role launches at, from .claude/agents/<role>.md (<role>; read-only)",
  operand: "role",
  run: tier
};
var equalizeCommand = {
  summary: "equalize the heights of the spawned panes (run after closing one)",
  async run({ json, deps }) {
    const callerPane = deps.env.HERDR_PANE_ID;
    if (deps.env.HERDR_ENV !== "1" || !callerPane) {
      deps.stderr(
        "Not inside Herdr (HERDR_ENV is not 1 or HERDR_PANE_ID is unset). Run this from a Herdr pane.\n"
      );
      return 1;
    }
    const result = await equalize(deps.runner, callerPane);
    if (result.status === "failed") {
      deps.stderr(`${result.reason}
`);
      return 1;
    }
    const text9 = result.status === "skipped" ? `Skipped: ${result.reason}.` : "Equalized.";
    deps.stdout(json ? `${JSON.stringify(result)}
` : `${text9}
`);
    return 0;
  }
};
var session = {
  spawn: spawnCommand,
  wait: waitCommand,
  close: closeCommand,
  tier: tierCommand,
  equalize: equalizeCommand
};

// src/cli/host.ts
var hostDomains = {
  hook,
  session,
  skill
};

// src/cli/domains.ts
var version = {
  summary: "print the harness version",
  run({ json, deps }) {
    deps.stdout(
      json ? `${JSON.stringify({ version: package_default.version })}
` : `harness ${package_default.version}
`
    );
    return Promise.resolve(0);
  }
};
var domains = {
  harness: { version },
  plan: {
    active: planActive,
    tick: planTick,
    next: planNext,
    "clear-next": planClearNext
  },
  adr: adrCommands,
  guardrail: guardrailCommands,
  ...hostDomains,
  ...records,
  ...measurement
};

// src/cli/cli.ts
var USAGE_ERROR2 = 2;
var FAILURE = 1;
function usage() {
  const lines2 = ["Usage: harness <domain> <command> [--json]", "", "Commands:"];
  for (const [domain, commands] of Object.entries(domains)) {
    for (const [name, command] of Object.entries(commands)) {
      lines2.push(
        `  harness ${[domain, name].filter(Boolean).join(" ")}  ${command.summary}`
      );
    }
  }
  lines2.push(
    "",
    "Flags:",
    "  --json  print machine-readable output",
    "  --help  show this usage"
  );
  return `${lines2.join("\n")}
`;
}
function fail4(deps, json, message, code = USAGE_ERROR2) {
  const prefix = json ? `${JSON.stringify({ error: message })}
` : "";
  deps.stderr(`${prefix}${message}

${usage()}`);
  return code;
}
function own(table, key) {
  return Object.hasOwn(table, key) ? table[key] : void 0;
}
function names2(commands) {
  return Object.keys(commands).join(", ");
}
function resolve9(domain, name) {
  const commands = own(domains, domain);
  if (commands === void 0) {
    return {
      error: `Unknown domain "${domain}". Domains: ${Object.keys(domains).join(", ")}.`
    };
  }
  if (name === void 0) {
    const only = own(commands, "");
    if (only !== void 0) {
      return { command: only };
    }
    return {
      error: `Missing command for domain "${domain}". Commands: ${names2(commands)}.`
    };
  }
  const command = own(commands, name);
  if (command === void 0) {
    return {
      error: `Unknown command "${name}" for domain "${domain}". Commands: ${names2(commands)}.`
    };
  }
  return { command };
}
function parseOptions(command, tokens) {
  const spec = command.options ?? {};
  const options = {};
  let operand;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (!token.startsWith("--")) {
      if (command.operand === void 0 || operand !== void 0) {
        return { error: `Unexpected argument "${token}".` };
      }
      operand = token;
      continue;
    }
    const [name = "", inline] = token.slice(2).split(/=(.*)/s, 2);
    const kind = own(spec, name);
    if (kind === void 0) {
      return { error: `Unknown flag "${token}".` };
    }
    if (kind === "boolean") {
      if (inline !== void 0) {
        return { error: `Flag "--${name}" takes no value.` };
      }
      options[name] = true;
      continue;
    }
    const value = inline ?? tokens[++i];
    if (value === void 0) {
      return { error: `Flag "--${name}" needs a value.` };
    }
    options[name] = value;
  }
  return operand === void 0 ? { options } : { options, operand };
}
async function execute(command, context2) {
  try {
    return await command.run(context2);
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    const { json, deps } = context2;
    const prefix = json ? `${JSON.stringify({ error: error.message })}
` : "";
    deps.stderr(`${prefix}${error.message}
`);
    return FAILURE;
  }
}
async function run2(argv, deps) {
  const json = argv.includes("--json");
  const help = argv.includes("--help") || argv.includes("-h");
  const words2 = [];
  argv.forEach((token, i) => {
    if (!token.startsWith("-") && words2.length < 2) {
      words2.push(i);
    }
  });
  const domain = argv[words2[0] ?? -1];
  const name = argv[words2[1] ?? -1];
  if (domain === void 0 || help && own(domains, domain) !== void 0) {
    deps.stdout(usage());
    return 0;
  }
  const rest = argv.filter(
    (token, i) => !words2.includes(i) && token !== "--json" && token !== "--help" && token !== "-h"
  );
  const failure2 = domain === "hook" ? FAILURE : USAGE_ERROR2;
  const early = argv.slice(0, words2[1] ?? 0).find((t) => t.startsWith("-") && !["--json", "--help", "-h"].includes(t));
  if (early !== void 0) {
    return fail4(
      deps,
      json,
      `Put "${early}" after the command: harness <domain> <command> [flags].`,
      failure2
    );
  }
  const resolved = resolve9(domain, name);
  if ("error" in resolved) {
    return fail4(deps, json, resolved.error, failure2);
  }
  const parsed = parseOptions(resolved.command, rest);
  if ("error" in parsed) {
    return fail4(deps, json, parsed.error, failure2);
  }
  return await execute(resolved.command, {
    json,
    options: parsed.options,
    operand: parsed.operand,
    deps
  });
}

// src/main.ts
var stderr = (text9) => process.stderr.write(text9);
var root2;
try {
  process.exitCode = await run2(process.argv.slice(2), {
    runner: new ProcessRunner(),
    clock: systemClock,
    fs: nodeFileSystem,
    ids: systemIds,
    env: process.env,
    cwd: process.cwd(),
    stdin: () => readStdin(process.stdin),
    root: () => root2 ??= resolveRoot(
      process.env,
      import.meta.url,
      (path) => nodeFileSystem.exists(path)
    ),
    stdout: (text9) => process.stdout.write(text9),
    stderr
  });
} catch (error) {
  stderr(`${error instanceof Error ? error.message : String(error)}
`);
  process.exitCode = 1;
}
