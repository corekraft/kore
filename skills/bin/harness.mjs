// src/runtime/errors.ts
var CommandError = class extends Error {
};

// src/runtime/clock.ts
var systemClock = {
  now: () => /* @__PURE__ */ new Date(),
  sleep: (ms) => new Promise((resolve6) => setTimeout(resolve6, ms))
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
  readdir,
  rm,
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
  remove: (path) => rm(path, { force: true })
};

// src/runtime/runner.ts
import { spawn } from "node:child_process";
var ProcessRunner = class {
  async run(command, args, options = {}) {
    return await new Promise((resolve6) => {
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
        resolve6({ stdout, stderr: error.message, code: 127 });
      });
      child.on("close", (code) => {
        resolve6({ stdout, stderr: stderr2, code: code ?? 1 });
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
  const git = await deps.runner.run(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: checkout }
  );
  const common = git.stdout.trim();
  return git.code === 0 && common !== "" ? dirname2(common) : void 0;
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
    throw new Error(
      `CLAUDE_PROJECT_DIR is "${fromEnv}" but it has no ${PLANS}. Point it at the repository root or unset it.`
    );
  }
  const bundle = fileURLToPath(moduleUrl);
  const root2 = resolve2(dirname3(bundle), "../..");
  if (await exists(join(root2, PLANS))) {
    return root2;
  }
  throw new Error(
    `Cannot find the repo root: ${bundle} is not at <root>/skills/bin and CLAUDE_PROJECT_DIR is unset. Run the committed skills/bin/harness.mjs or set CLAUDE_PROJECT_DIR to the repository root.`
  );
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
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug === "") {
    throw new AdrError(
      "--title needs at least one letter or digit; give the decision a short name."
    );
  }
  return slug;
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
    const text3 = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line2)?.[1];
    if (text3 === void 0) {
      continue;
    }
    const base = headingSlug(text3);
    const count2 = seen.get(base) ?? 0;
    seen.set(base, count2 + 1);
    found.push({ text: text3, anchor: count2 > 0 ? `${base}-${count2}` : base });
  }
  return found;
}
function adrNumber(file) {
  const match = /^(\d{4})-.+\.md$/.exec(file);
  return match?.[1] === void 0 ? null : Number(match[1]);
}
var Adrs = class {
  constructor(fs, clock, root2) {
    this.fs = fs;
    this.clock = clock;
    this.root = root2;
  }
  fs;
  clock;
  root;
  async create(input, dryRun) {
    this.checkStatus(input.status);
    checkSummary(input.summary);
    const slug = kebab(input.title);
    const next = Math.max(
      0,
      ...(await this.fs.readdir(this.abs(DECISIONS))).map(
        (f) => adrNumber(f) ?? 0
      )
    ) + 1;
    const number = String(next).padStart(4, "0");
    const file = `${number}-${slug}.md`;
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
    const entry = `- [\`${path}\`](decisions/${file}) \u2014 ${input.summary}`;
    const index = this.insert(indexText, next, entry);
    const report2 = {
      dryRun,
      number,
      files: [
        {
          path,
          lines: body.slice(0, -1).map((text3, i) => ({ number: i + 1, text: text3 }))
        },
        { path: INDEX, lines: [{ number: index.line, text: entry }] }
      ]
    };
    if (!dryRun) {
      await this.fs.writeFile(this.abs(path), body.join("\n"));
      await this.fs.writeFile(this.abs(INDEX), index.text);
    }
    return report2;
  }
  async readIndex() {
    if (!await this.fs.exists(this.abs(INDEX))) {
      throw new AdrError(`${INDEX} is missing; restore it from git.`);
    }
    return this.fs.readFile(this.abs(INDEX));
  }
  /** Puts the entry before the first later-numbered ADR line, else after the last one. */
  insert(text3, next, entry) {
    const lines = text3.split("\n");
    const start = lines.indexOf("## Decisions");
    if (start === -1) {
      throw new AdrError(
        `${INDEX} has no "## Decisions" heading; add it above the ADR entries.`
      );
    }
    let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
    if (end === -1) {
      end = lines.length;
    }
    const at = this.position(lines, start, end, next);
    lines.splice(at, 0, entry);
    return { text: lines.join("\n"), line: at + 1 };
  }
  /** Index of the line to insert at: before the first later ADR entry, else after the last. */
  position(lines, start, end, next) {
    let last = -1;
    for (let i = start + 1; i < end; i++) {
      const n = /\]\(decisions\/(\d{4})-/.exec(lines[i] ?? "")?.[1];
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
    while (tail > start && lines[tail] === "") {
      tail--;
    }
    return tail + 1;
  }
  abs(path) {
    return `${this.root}/${path}`;
  }
  checkStatus(status) {
    if (status === "superseded") {
      throw new AdrError(
        "--status superseded cannot be written by adr new, which has no superseded-by to record; create the ADR as proposed or accepted, then run `harness adr supersede`."
      );
    }
    if (!STATUSES.includes(status)) {
      throw new AdrError(
        `--status is "${status}"; use one of ${STATUSES.join(", ")}.`
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
function frontmatterLine(lines, key) {
  if (lines[0] !== "---") {
    return -1;
  }
  const close2 = lines.indexOf("---", 1);
  const end = close2 === -1 ? lines.length : close2;
  return lines.findIndex((l, i) => i > 0 && i < end && l.startsWith(`${key}:`));
}
var Supersession = class {
  constructor(fs, root2) {
    this.fs = fs;
    this.root = root2;
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
    const lines = [
      ...oldAdr.lines.slice(0, oldAdr.statusLine),
      ...changed,
      ...oldAdr.lines.slice(oldAdr.statusLine + 1)
    ];
    if (!dryRun) {
      await this.fs.writeFile(this.abs(oldAdr.path), lines.join("\n"));
    }
    return {
      dryRun,
      old,
      new: next,
      files: [
        {
          path: oldAdr.path,
          lines: changed.map((text3, i) => ({
            number: oldAdr.statusLine + 1 + i,
            text: text3
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
    const matches2 = (await this.fs.readdir(this.abs(DECISIONS))).filter(
      (f) => f.startsWith(`${number}-`) && f.endsWith(".md") && f.length > number.length + 4
    ).sort();
    if (matches2.length > 1) {
      throw new AdrError(
        `ADR ${number} matches more than one file: ${matches2.map((f) => `${DECISIONS}/${f}`).join(", ")}; renumber one so each ADR number is unique, then retry.`
      );
    }
    const file = matches2[0];
    if (file === void 0) {
      throw new AdrError(
        `ADR ${number} does not exist; ${replacement ? "create it first with `harness adr new`" : "check the number against docs/decisions/"}.`
      );
    }
    const path = `${DECISIONS}/${file}`;
    const lines = (await this.fs.readFile(this.abs(path))).split("\n");
    const statusLine = frontmatterLine(lines, "status");
    if (statusLine === -1) {
      throw new AdrError(
        `${path} has no frontmatter status; add a "status:" line before superseding it.`
      );
    }
    return { path, lines, statusLine };
  }
  abs(path) {
    return `${this.root}/${path}`;
  }
};

// src/adr/commands.ts
var REQUIRED = ["title", "summary", "status", "source"];
function describe(report2) {
  const verb = report2.dryRun ? "Would write" : "Wrote";
  return `${report2.files.map(
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
    const [title, summary, status, source] = REQUIRED.map(
      (key) => requiredFlag(options, key, "text")
    );
    const refines = typeof options["refines"] === "string" ? options["refines"].trim() : void 0;
    const root2 = await repoRoot(deps);
    const report2 = await new Adrs(deps.fs, deps.clock, root2).create(
      { title, summary, status, source, ...refines ? { refines } : {} },
      options["dry-run"] === true
    );
    deps.stdout(json ? `${JSON.stringify(report2)}
` : describe(report2));
    return 0;
  })
};
var supersede = {
  summary: "mark an ADR superseded by another (--old N --new M [--dry-run])",
  options: { old: "string", new: "string", "dry-run": "boolean" },
  run: ({ json, options, deps }) => withAdrErrors(json, deps, async () => {
    const root2 = await repoRoot(deps);
    const report2 = await new Supersession(deps.fs, root2).supersede(
      requiredFlag(options, "old", "number"),
      requiredFlag(options, "new", "number"),
      options["dry-run"] === true
    );
    const verb = report2.dryRun ? "Would set" : "Set";
    deps.stdout(
      json ? `${JSON.stringify(report2)}
` : `${verb} ${report2.files[0]?.path} to status superseded, superseded-by ADR ${report2.new}
`
    );
    return 0;
  })
};
var adrCommands = {
  new: newAdr,
  supersede
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
function frontmatter(text3) {
  const lines = text3.split("\n");
  if (lines[0] !== "---") {
    return null;
  }
  const keys = /* @__PURE__ */ new Map();
  for (const line2 of lines.slice(1)) {
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
function parseIdea(path, text3) {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const name = IDEA_FILE.exec(file);
  if (name?.[1] === void 0 || name[2] === void 0) {
    throw new IdeaError(
      `${path} is not named NNNN-slug.md; rename it to a four-digit number and a lowercase slug.`
    );
  }
  const keys = frontmatter(text3);
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
  const heading = /^# Idea \d{4}: (.+)$/m.exec(text3)?.[1];
  const record2 = {
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
      record2[key] = get(key);
    }
  }
  return record2;
}
function scalar(flag, value) {
  const text3 = (value ?? "").replace(/\s+/g, " ").trim();
  if (text3 === "") {
    throw new IdeaError(`Missing --${flag}; pass a non-empty value.`);
  }
  if (/^[[{|>&*!-]/.test(text3)) {
    throw new IdeaError(
      `--${flag} must not start with "${text3.slice(0, 1)}"; frontmatter holds plain text, so reword it.`
    );
  }
  return text3;
}
function renderIdea(number, date, idea) {
  const lines = [
    "---",
    `summary: ${idea.summary}`,
    `hypothesis: ${idea.hypothesis}`,
    `expected-outcome: ${idea.expectedOutcome}`,
    `measurement: ${idea.measurement}`,
    `safety-pattern: ${idea.safetyPattern}`,
    `date: ${date}`
  ];
  if (idea.issue !== void 0) {
    lines.push(`issue: ${idea.issue}`);
  }
  if (idea.parent !== void 0) {
    lines.push(`parent: ${idea.parent}`);
  }
  lines.push("---", "", `# Idea ${number}: ${idea.title}`, "");
  return lines.join("\n");
}
function withIssue(text3, issue) {
  const lines = text3.split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1) {
    throw new IdeaError("The idea has no frontmatter to record the issue in.");
  }
  const at = lines.findIndex(
    (l, i) => i > 0 && i < end && l.startsWith("issue:")
  );
  if (at === -1) {
    lines.splice(end, 0, `issue: ${issue}`);
  } else {
    lines[at] = `issue: ${issue}`;
  }
  return lines.join("\n");
}

// src/idea/repository.ts
var INDEX2 = "docs/index.md";
var DIR = "docs/ideas";
var ATTEMPTS = 3;
var HEADING = "## Ideas";
var NEXT_SECTION = "## Operations and Guides";
var IdeaRepository = class {
  constructor(fs, clock, root2) {
    this.fs = fs;
    this.clock = clock;
    this.root = root2;
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
      const [, number, slug] = IDEA_FILE.exec(n) ?? [];
      return wanted === number || wanted === slug || `${number}-${slug}` === wanted;
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
  async create(slug, idea) {
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
      const names2 = await this.listNames();
      const existing = names2.find((n) => IDEA_FILE.exec(n)?.[2] === slug);
      if (existing !== void 0) {
        const record3 = await this.read(existing);
        await this.ensureIndexed(record3);
        return { created: false, record: record3 };
      }
      const taken = names2.map((n) => Number(n.slice(0, 4)));
      const number = String(Math.max(0, ...taken) + 1).padStart(4, "0");
      const path = `${DIR}/${number}-${slug}.md`;
      const text3 = renderIdea(
        number,
        this.clock.now().toISOString().slice(0, 10),
        idea
      );
      try {
        await this.fs.createFile(this.abs(path), text3);
      } catch (error) {
        if (error.code === "EEXIST") {
          continue;
        }
        throw error;
      }
      const record2 = parseIdea(path, text3);
      await this.ensureIndexed(record2);
      return { created: true, record: record2 };
    }
    throw new IdeaError(
      `Another writer keeps creating ideas in ${DIR}; rerun \`harness idea new\` once it finishes.`
    );
  }
  /** The raw markdown of an idea. */
  async source(record2) {
    return await this.fs.readFile(this.abs(record2.path));
  }
  /** Records the idea's issue link in its frontmatter, touching nothing else. */
  async recordIssue(record2, issue) {
    await this.fs.writeFile(
      this.abs(record2.path),
      withIssue(await this.source(record2), issue)
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
  async ensureIndexed(record2) {
    const index = await this.fs.readFile(this.abs(INDEX2));
    if (!index.includes(`](${record2.path.replace(/^docs\//, "")})`)) {
      await this.fs.writeFile(
        this.abs(INDEX2),
        addEntry(index, record2.path, record2.summary)
      );
    }
  }
  async listNames() {
    return await this.fs.exists(this.abs(DIR)) ? (await this.fs.readdir(this.abs(DIR))).filter((f) => IDEA_FILE.test(f)).sort() : [];
  }
};
function addEntry(index, path, summary) {
  const entry = `- [\`${path}\`](${path.replace(/^docs\//, "")}) \u2014 ${summary}`;
  const lines = index.split("\n");
  const start = lines.indexOf(HEADING);
  if (start === -1) {
    const next = lines.indexOf(NEXT_SECTION);
    const at = next === -1 ? lines.length : next;
    const block = [HEADING, "", entry, ""];
    if (next === -1 && lines.at(-1) === "") {
      lines.splice(lines.length - 1, 0, "", ...block.slice(0, -1));
    } else {
      lines.splice(at, 0, ...block);
    }
    return lines.join("\n");
  }
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) {
    end = lines.length;
  }
  while (end > start + 1 && lines[end - 1] === "") {
    end--;
  }
  lines.splice(end, 0, entry);
  return lines.join("\n");
}

// src/idea/sync.ts
var NOT_FOUND = /could not resolve to an issue|issue .*not found|no issue/i;
var ISSUE_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/;
function prose(text3) {
  const lines = text3.split("\n");
  const at = lines.findIndex((l) => /^# Idea \d{4}: /.test(l));
  return (at === -1 ? "" : lines.slice(at + 1).join("\n")).trim();
}
function renderBody(record2, text3) {
  const sections = [
    `<!-- Generated by \`harness idea sync\` from ${record2.path}. Edit that file; changes made here are overwritten. -->`,
    `## Summary

${record2.summary}`,
    `## Hypothesis

${record2.hypothesis}`,
    `## Expected outcome

${record2.expectedOutcome}`,
    `## Measurement

${record2.measurement}`,
    `## Safety pattern

${record2.safetyPattern}`
  ];
  const extra = prose(text3);
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
async function reconcile(gh, record2, body, at) {
  const title = record2.title.trim();
  const issue = record2.issue ?? "";
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
async function syncIssue(runner, root2, record2, text3, recordLink) {
  const body = renderBody(record2, text3);
  const gh = async (args, input) => await runner.run("gh", args, {
    cwd: root2,
    ...input === void 0 ? {} : { input }
  });
  const at = record2.issue === void 0 ? void 0 : locate(record2.issue);
  if (record2.issue !== void 0 && at === void 0) {
    throw new IdeaError(
      `${record2.path} has issue "${record2.issue}", which is not an issue number or link; set it to e.g. 123 or https://github.com/<owner>/<repo>/issues/123.`
    );
  }
  const repo = await resolveRepo(gh, at?.repo);
  const existing = at === void 0 ? void 0 : await reconcile(gh, record2, body, { number: at.number, repo });
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
      record2.title.trim(),
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
      `gh reported success but printed no issue link, so the issue may exist: check the repository's issues for "${record2.title.trim()}" in ${repo}, add \`issue: <url>\` to ${record2.path}, then rerun \`harness idea sync\`; otherwise a duplicate is created.`
    );
  }
  try {
    await recordLink(url);
  } catch (error) {
    throw new IdeaError(
      `Created ${url} but could not record it in ${record2.path}: ${error instanceof Error ? error.message : String(error)}. Add \`issue: ${url}\` to its frontmatter, then rerun \`harness idea sync\`; otherwise a second issue is created.`
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

// src/idea/commands.ts
var FAILED = 1;
var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
async function repository({ deps }) {
  const root2 = await deps.root().catch((cause) => {
    throw new IdeaError(cause instanceof Error ? cause.message : String(cause));
  });
  return new IdeaRepository(deps.fs, deps.clock, root2);
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
function text(options, key) {
  const value = options[key];
  return typeof value === "string" ? value : void 0;
}
function slugOf(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
}
function describe2(record2) {
  const lines = [
    `Idea ${record2.number}: ${record2.title}`,
    `Date: ${record2.date}`,
    `Summary: ${record2.summary}`,
    `Hypothesis: ${record2.hypothesis}`,
    `Expected outcome: ${record2.expectedOutcome}`,
    `Measurement: ${record2.measurement}`,
    `Safety pattern: ${record2.safetyPattern}`
  ];
  for (const [label, value] of [
    ["Outcome", record2.outcome],
    ["Issue", record2.issue],
    ["Parent", record2.parent]
  ]) {
    if (value !== void 0) {
      lines.push(`${label}: ${value}`);
    }
  }
  lines.push(`File: ${record2.path}`);
  return `${lines.join("\n")}
`;
}
function parseNewIdea(options) {
  const title = scalar("title", text(options, "title"));
  const slug = text(options, "slug") ?? slugOf(title);
  if (!SLUG.test(slug)) {
    throw new IdeaError(
      `Slug "${slug}" is invalid; use lowercase letters, digits and single hyphens, e.g. cache-probe-results.`
    );
  }
  const idea = {
    title,
    summary: scalar("summary", text(options, "summary") ?? title),
    hypothesis: scalar("hypothesis", text(options, "hypothesis")),
    expectedOutcome: scalar(
      "expected-outcome",
      text(options, "expected-outcome")
    ),
    measurement: scalar("measurement", text(options, "measurement")),
    safetyPattern: scalar("safety-pattern", text(options, "safety-pattern"))
  };
  for (const key of ["issue", "parent"]) {
    const value = text(options, key);
    if (value !== void 0) {
      idea[key] = scalar(key, value);
    }
  }
  return { slug, idea };
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
  run(context) {
    return guarded(context, async () => {
      const { slug, idea } = parseNewIdea(context.options);
      const { created, record: record2 } = await (await repository(context)).create(slug, idea);
      context.deps.stdout(
        context.json ? `${JSON.stringify({ created, ...record2 })}
` : `${created ? "Created" : "Already exists:"} ${record2.path}
`
      );
    });
  }
};
var show = {
  summary: "print one idea record (--idea <number or slug>)",
  options: { idea: "string" },
  run(context) {
    return guarded(context, async () => {
      const ref = text(context.options, "idea");
      if (ref === void 0 || ref.trim() === "") {
        throw new IdeaError(
          "Missing --idea; run `harness idea show --idea <number or slug>`, or `harness idea list` to see the ideas."
        );
      }
      const record2 = await (await repository(context)).get(ref.trim());
      context.deps.stdout(
        context.json ? `${JSON.stringify(record2)}
` : describe2(record2)
      );
    });
  }
};
var list = {
  summary: "list every idea record in number order",
  run(context) {
    return guarded(context, async () => {
      const records = await (await repository(context)).list();
      context.deps.stdout(
        context.json ? `${JSON.stringify(records)}
` : records.map((r) => `${r.number} ${r.outcome ?? "open"} ${r.title}
`).join("")
      );
    });
  }
};
var sync = {
  summary: "mirror one idea to its GitHub issue, creating it when missing and editing only when the body changed (--idea <number or slug>)",
  options: { idea: "string" },
  run(context) {
    return guarded(context, async () => {
      const ref = text(context.options, "idea");
      if (ref === void 0 || ref.trim() === "") {
        throw new IdeaError(
          "Missing --idea; run `harness idea sync --idea <number or slug>`, or `harness idea list` to see the ideas."
        );
      }
      const repo = await repository(context);
      const record2 = await repo.get(ref.trim());
      const result = await syncIssue(
        context.deps.runner,
        await context.deps.root(),
        record2,
        await repo.source(record2),
        (url) => repo.recordIssue(record2, url)
      );
      context.deps.stdout(
        context.json ? `${JSON.stringify({ idea: record2.number, ...result })}
` : `Issue ${result.action}: ${result.issue}
`
      );
    });
  }
};
var ideaCommands = {
  new: create,
  list,
  show,
  sync
};

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
  "pr.opened": "merge",
  "pr.merged": "merge"
};
var MIN_COMPLETED_IDEAS = 3;

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

// src/flow/toil.ts
var newLife = (first) => ({
  began: first.kind === "pane.spawned" || first.kind === "session.start",
  lastToolAt: void 0,
  failed: void 0,
  waits: []
});
function chargeToil(add, event, at, start, life) {
  const gap = (from, to) => uncovered([from, to], life.waits);
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

// src/flow/tally.ts
var emptyMillis = () => ({
  activeMs: 0,
  waitingMs: 0,
  events: 0,
  toilMs: { starting: 0, stopping: 0, waiting: 0, retrying: 0 }
});
var Tally = class {
  totals = new Map(
    STAGES.map((stage) => [stage, emptyMillis()])
  );
  add(stage, field2, ms) {
    this.totals.get(stage)[field2] += ms;
  }
  addToil(stage, kind, ms) {
    this.totals.get(stage).toilMs[kind] += ms;
  }
  count(stage) {
    this.totals.get(stage).events += 1;
  }
  /** Stages in loop order, with milliseconds converted to seconds. */
  stages() {
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
        }
      };
    });
  }
};

// src/flow/report.ts
var REPORT_VERSION = 2;
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
var time = (event) => Date.parse(event.occurredAt);
function roleOf(event) {
  for (const name of [event.agent, event.pane, event.session]) {
    const role = name?.split("-").at(-1);
    if (role !== void 0 && Object.hasOwn(ROLE_STAGES, role)) {
      return ROLE_STAGES[role];
    }
  }
  return void 0;
}
function chargeActor(tally, items) {
  const spans = [];
  let closed = false;
  let start = time(items[0].event);
  let life = newLife(items[0].event);
  items.forEach(({ event, stage }, i) => {
    const at = time(event);
    if (closed && (event.kind === "pane.spawned" || event.kind === "session.start")) {
      closed = false;
      start = at;
      life = newLife(event);
    }
    const state = STATE_AFTER[event.kind];
    if (closed) {
      return;
    }
    chargeToil(
      (kind, ms) => tally.addToil(stage, kind, ms),
      event,
      at,
      start,
      life
    );
    if (state === "closed") {
      closed = true;
      spans.push([start, at]);
    } else if (state !== void 0 && i < items.length - 1) {
      const next = time(items[i + 1].event);
      tally.add(
        stage,
        state === "active" ? "activeMs" : "waitingMs",
        next - at
      );
      if (state === "waiting") {
        life.waits.push([at, next]);
        tally.addToil(stage, "waiting", next - at);
      }
    }
  });
  if (!closed) {
    spans.push([start, time(items.at(-1).event)]);
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
  for (const items of byActor.values()) {
    items.sort((x, y) => time(x.event) - time(y.event));
    const spans = chargeActor(tally, items);
    if (items[0].stage !== "orchestrate") {
      lifetimes.push(...spans);
    }
  }
  return lifetimes;
}
function firstTime(events, match) {
  return events.filter(match).map(time).sort((a, b) => a - b)[0];
}
function githubWaits(tally, events, holes, asOf) {
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
  for (const [stage, start, end] of waits) {
    if (start !== void 0) {
      const stop = end ?? closed ?? asOf;
      if (stop > start) {
        tally.add(stage, "waitingMs", uncovered([start, stop], holes));
      }
    }
  }
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
    const open = role.after === void 0 || gate !== void 0 && time(event) >= gate;
    return open ? role.stage : void 0;
  }
  return event.pane === void 0 && event.source === "claude" ? MAIN_SESSION_STAGE : void 0;
}
function roundShare(share) {
  return Math.round(share * 1e4) / 1e4;
}
function groupByIdea(events) {
  const ideaOf = attribute(events);
  const byIdea = /* @__PURE__ */ new Map();
  let unattributed = 0;
  for (const event of events) {
    const idea = ideaOf.get(event.id);
    if (idea === void 0) {
      unattributed += 1;
    } else {
      byIdea.set(idea, [...byIdea.get(idea) ?? [], event]);
    }
  }
  return { byIdea, unattributed };
}
function chargeIdea(tally, own2, asOf) {
  const mergedAt = firstTime(own2, (e) => e.kind === "pr.merged");
  const mapped = [];
  for (const event of own2) {
    const stage = stageOf(event, mergedAt);
    if (stage !== void 0) {
      tally.count(stage);
      mapped.push({ event, stage });
    }
  }
  githubWaits(tally, own2, actorTime(tally, mapped), asOf);
  return own2.length - mapped.length;
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
function buildReport(events, { asOf, minCompletedIdeas }) {
  const { byIdea, unattributed } = groupByIdea(events);
  const tally = new Tally();
  let unmapped = unattributed;
  let completed = 0;
  for (const own2 of byIdea.values()) {
    unmapped += chargeIdea(tally, own2, asOf.getTime());
    completed += own2.some((e) => e.kind === "issue.closed") ? 1 : 0;
  }
  return {
    version: REPORT_VERSION,
    asOf: asOf.toISOString(),
    ideas: { total: byIdea.size, completed },
    minCompletedIdeas,
    stages: tally.stages(),
    ...nameBottleneck(tally, completed, minCompletedIdeas),
    unmappedEvents: unmapped
  };
}

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
var KINDS = [
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
  "pr.merged"
];
var OUTCOMES = ["success", "failure"];
var TOOL_KINDS = ["tool.start", "tool.end"];
var NUMBER_KINDS = [
  "issue.opened",
  "issue.labelled",
  "issue.closed",
  "pr.opened",
  "pr.merged"
];
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
  "number"
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
function bad(field2, problem) {
  return {
    ok: false,
    field: field2,
    message: `Invalid event: field "${field2}" ${problem}.`
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
    kinds: ["issue.labelled"]
  },
  {
    field: "number",
    check: (v) => Number.isSafeInteger(v) && v >= 1,
    hint: "must be a positive integer",
    kinds: NUMBER_KINDS
  }
];
function checkShape(input, mode) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return bad("event", "must be a JSON object");
  }
  const raw = input;
  for (const key of Object.keys(raw)) {
    if (!ALLOWED.has(key) && raw[key] !== void 0) {
      return bad(key, "is not a ledger field and is never stored");
    }
  }
  if (mode === "input") {
    for (const field2 of ["recordedAt", "schema"]) {
      if (raw[field2] !== void 0) {
        return bad(field2, "is set by the ledger, not the caller");
      }
    }
  }
  return void 0;
}
function checkCore(raw, mode) {
  if (mode === "stored" && raw["schema"] !== SCHEMA_VERSION) {
    return bad("schema", `must be ${SCHEMA_VERSION}`);
  }
  if (!SOURCES.includes(raw["source"])) {
    return bad("source", `must be one of ${SOURCES.join(", ")}`);
  }
  if (!KINDS.includes(raw["kind"])) {
    return bad("kind", `must be one of ${KINDS.join(", ")}`);
  }
  const times = mode === "stored" ? ["occurredAt", "recordedAt"] : ["occurredAt"];
  for (const field2 of times) {
    const value = raw[field2];
    if (typeof value !== "string" || !isTimestamp(value)) {
      return bad(field2, TIME_HINT);
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
    return needed ? bad(rule.field, `is required on ${kind} events`) : void 0;
  }
  if (!applies) {
    return bad(
      rule.field,
      `is only allowed on ${rule.kinds?.join(" and ")} events`
    );
  }
  return rule.check(value) ? void 0 : bad(rule.field, rule.hint);
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
var describe3 = (code, stdout, stderr2) => {
  const text3 = `${stderr2}${stdout}`.trim();
  return text3 === "" ? `exit code ${code}` : `exit code ${code}: ${text3}`;
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
    return `gh ${what} failed: ${describe3(found.code, found.stdout, found.stderr)}. Is gh installed and logged in (gh auth status)?`;
  }
  let value;
  try {
    value = JSON.parse(found.stdout);
  } catch {
    return `gh ${what} did not print JSON. Run it by hand and check the gh version.`;
  }
  const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  return Array.isArray(value) && value.every(isObject) ? value : `gh ${what} did not print a JSON list of objects; the gh version may have changed its output.`;
}
var asRecord = (value) => typeof value === "object" && value !== null ? value : {};
var when = (value) => typeof value === "string" && isTimestamp(value) ? value : void 0;
var count = (value) => Number.isSafeInteger(value) && value >= 1 ? value : void 0;
function fromItems(items, openedKind, mergedKind) {
  const out = [];
  for (const item of items) {
    const raw = asRecord(item);
    const number = count(raw["number"]);
    const opened = when(raw["createdAt"]);
    const merged = when(raw["mergedAt"]);
    if (number === void 0) {
      continue;
    }
    const at = (kind, occurredAt, id) => out.push({ id, source: "github", kind, occurredAt, number });
    if (opened !== void 0) {
      at(openedKind, opened, `github:${openedKind}:${number}`);
    }
    if (mergedKind !== void 0 && merged !== void 0) {
      at(mergedKind, merged, `github:${mergedKind}:${number}`);
    }
  }
  return out;
}
function fromLabelEvents(items) {
  const out = [];
  for (const item of items) {
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
var searchFrom = (field2, since) => since === void 0 ? [] : ["--search", `${field2}:>=${since.slice(0, 10)}`];
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
    ...searchFrom("created", since),
    "--json",
    "number,createdAt"
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
    "number,createdAt,mergedAt"
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
    ...fromItems(issues, "issue.opened"),
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
function describe4(code, stdout, stderr2) {
  const text3 = `${stderr2}${stdout}`.trim();
  return text3 === "" ? `exit code ${code}` : `exit code ${code}: ${text3}`;
}
function toSeen(entry) {
  if (typeof entry !== "object" || entry === null) {
    return void 0;
  }
  const raw = entry;
  const pane = raw["pane_id"];
  const status = STATUS_KIND[String(raw["agent_status"])];
  const agent = [raw["name"], raw["agent"]].find(isName) ?? "unknown";
  if (!isName(pane) || status === void 0) {
    return void 0;
  }
  return { pane, agent, status };
}
async function listAgents(runner) {
  const found = await runner.run("herdr", ["agent", "list"]);
  if (found.code !== 0) {
    return {
      message: `herdr agent list failed: ${describe4(found.code, found.stdout, found.stderr)}. Is the herdr server running?`
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
  for (const entry of agents) {
    const pane = entry?.pane_id;
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
  for (const { pane, agent, status } of listed.seen) {
    const recorded = last.get(pane);
    const open = recorded !== void 0 && recorded.kind !== "pane.closed";
    if (open && recorded.agent !== void 0 && recorded.agent !== agent) {
      event("pane.closed", pane, recorded.agent);
    }
    const sameAgent = open && (recorded.agent ?? agent) === agent;
    if (!sameAgent) {
      event("pane.spawned", pane, agent);
    }
    if (!sameAgent || recorded.kind !== status) {
      event(status, pane, agent);
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
    const text3 = await this.read();
    const events = [];
    let skipped = 0;
    for (const line2 of text3.split("\n")) {
      if (line2 === "") {
        continue;
      }
      const event = parseLine(line2);
      if (event === void 0) {
        skipped += 1;
      } else if (matches(event, filter)) {
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
function matches(event, filter) {
  return (filter.session === void 0 || event.session === filter.session) && (filter.pane === void 0 || event.pane === filter.pane) && (filter.idea === void 0 || event.idea === filter.idea) && (filter.source === void 0 || event.source === filter.source) && (filter.kind === void 0 || event.kind === filter.kind) && (filter.since === void 0 || Date.parse(event.occurredAt) >= Date.parse(filter.since)) && (filter.until === void 0 || Date.parse(event.occurredAt) < Date.parse(filter.until));
}

// src/cli/ledger-commands.ts
import { resolve as resolve3 } from "node:path";
var DEFAULT_LEDGER = ".kore/state/ledger.jsonl";
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
  "number"
];
var STRING_FLAGS = (names2) => Object.fromEntries(names2.map((n) => [n, "string"]));
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
async function openLedger(context) {
  const path = await ledgerPath(context);
  if (path === void 0) {
    return { error: NO_ROOT };
  }
  const { deps } = context;
  return { ledger: new Ledger(deps.fs, deps.clock, deps.ids, path) };
}
async function eventInput(context) {
  const given = EVENT_FLAGS.filter((f) => context.options[f] !== void 0);
  if (given.length > 0) {
    return {
      input: Object.fromEntries(
        given.map((f) => {
          const value = String(context.options[f]);
          const isCount = f === "number" && /^\d+$/.test(value);
          return [camel(f), isCount ? Number(value) : value];
        })
      )
    };
  }
  const text3 = await context.deps.stdin();
  if (text3.trim() === "") {
    return {
      error: "No event given. Pass --source, --kind and --occurred-at, or one JSON event on stdin.",
      code: 2
    };
  }
  try {
    return { input: JSON.parse(text3) };
  } catch {
    return { error: "Invalid event: stdin is not valid JSON." };
  }
}
function reject({ json, deps }, message, field2, code = 1) {
  deps.stderr(
    json ? `${JSON.stringify({ error: message, field: field2 })}
` : `${message}
`
  );
  return code;
}
var record = {
  summary: "append one validated event, from flags or JSON on stdin, to the stage ledger",
  options: STRING_FLAGS([...EVENT_FLAGS, "ledger"]),
  async run(context) {
    const given = await eventInput(context);
    if ("error" in given) {
      return reject(context, given.error, "event", given.code);
    }
    const opened = await openLedger(context);
    if ("error" in opened) {
      return reject(context, opened.error, "ledger");
    }
    const result = await opened.ledger.record(given.input);
    if (!result.ok) {
      return reject(context, result.message, result.field);
    }
    context.deps.stdout(
      context.json ? `${JSON.stringify({ event: result.event })}
` : `recorded ${result.event.id} ${result.event.kind}
`
    );
    return 0;
  }
};
function filterFrom(options) {
  const filter = {};
  const text3 = (name) => {
    const value = options[name];
    return typeof value === "string" ? value : void 0;
  };
  for (const name of ["session", "pane", "idea"]) {
    const value = text3(name);
    if (value !== void 0) {
      filter[name] = value;
    }
  }
  const source = text3("source");
  if (source !== void 0) {
    if (!SOURCES.includes(source)) {
      return {
        error: `Invalid --source "${source}". Sources: ${SOURCES.join(", ")}.`
      };
    }
    filter.source = source;
  }
  const kind = text3("kind");
  if (kind !== void 0) {
    if (!KINDS.includes(kind)) {
      return { error: `Invalid --kind "${kind}". Kinds: ${KINDS.join(", ")}.` };
    }
    filter.kind = kind;
  }
  for (const name of ["since", "until"]) {
    const value = text3(name);
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
var list2 = {
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
  async run(context) {
    const parsed = filterFrom(context.options);
    if ("error" in parsed) {
      return reject(context, parsed.error, "filter", 2);
    }
    const opened = await openLedger(context);
    if ("error" in opened) {
      return reject(context, opened.error, "ledger");
    }
    const { events, skipped } = await opened.ledger.list(parsed.filter);
    if (context.json) {
      context.deps.stdout(`${JSON.stringify({ events, skipped })}
`);
      return 0;
    }
    context.deps.stdout(events.map((e) => `${line(e)}
`).join(""));
    if (skipped > 0) {
      context.deps.stdout(`skipped ${skipped} malformed ledger line(s)
`);
    }
    return 0;
  }
};
var pollHerdrCommand = {
  summary: "read herdr's agent panes once and append only the changes (pane.spawned, pane.busy, pane.waiting, pane.closed) to the ledger; pane.closed means the pane no longer hosts an agent; safe to repeat from a wait loop, and one poll runs at a time",
  options: STRING_FLAGS(["ledger"]),
  async run(context) {
    const opened = await openLedger(context);
    if ("error" in opened) {
      return reject(context, opened.error, "ledger");
    }
    const { runner, clock, fs } = context.deps;
    const result = await pollHerdr({
      ledger: opened.ledger,
      runner,
      clock,
      fs
    });
    if (!result.ok) {
      return reject(context, result.message, "herdr");
    }
    context.deps.stdout(
      context.json ? `${JSON.stringify({ recorded: result.recorded, events: result.events })}
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
  async run(context) {
    const since = context.options["since"];
    if (typeof since === "string" && !isTimestamp(since)) {
      return reject(
        context,
        `Invalid --since "${since}". Use an ISO 8601 UTC time such as 2026-01-02T03:04:05Z.`,
        "since",
        2
      );
    }
    const repo = context.options["repo"];
    if (typeof repo === "string" && !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      return reject(
        context,
        `Invalid --repo "${repo}". Use owner/name, such as ${DEFAULT_REPO}.`,
        "repo",
        2
      );
    }
    const opened = await openLedger(context);
    if ("error" in opened) {
      return reject(context, opened.error, "ledger");
    }
    const { runner, clock, fs } = context.deps;
    const result = await pollGithub({
      ledger: opened.ledger,
      runner,
      clock,
      fs,
      repo: typeof repo === "string" ? repo : DEFAULT_REPO,
      ...typeof since === "string" ? { since } : {}
    });
    if (!result.ok) {
      return reject(context, result.message, "github");
    }
    context.deps.stdout(
      context.json ? `${JSON.stringify({ recorded: result.recorded, events: result.events })}
` : `recorded ${result.recorded} github event(s)
`
    );
    return 0;
  }
};
var ledgerCommands = {
  record,
  list: list2,
  "poll-herdr": pollHerdrCommand,
  "poll-github": pollGithubCommand
};

// src/cli/flow-commands.ts
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
  const given = options["as-of"];
  if (given === void 0) {
    return { asOf: deps.clock.now(), minCompletedIdeas };
  }
  if (typeof given !== "string" || !isTimestamp(given)) {
    return {
      error: `Invalid --as-of "${String(given)}". Use an ISO 8601 UTC time such as 2026-01-02T03:04:05Z.`
    };
  }
  return { asOf: new Date(given), minCompletedIdeas };
}
var seconds = (value) => `${Math.round(value)}s`;
function text2(report2) {
  const rows = report2.stages.map(
    (s) => [
      s.stage.padEnd(15),
      `active ${seconds(s.activeSeconds)}`.padEnd(16),
      `waiting ${seconds(s.waitingSeconds)}`.padEnd(17),
      `${s.events} events`.padEnd(11),
      `toil start ${seconds(s.toil.startingSeconds)} stop ${seconds(s.toil.stoppingSeconds)} wait ${seconds(s.toil.waitingSeconds)} retry ${seconds(s.toil.retryingSeconds)}`
    ].join(" ")
  );
  const lines = [
    `Flow report as of ${report2.asOf}: ${report2.ideas.completed} of ${report2.ideas.total} ideas completed`,
    ...rows,
    `Unmapped events: ${report2.unmappedEvents}`,
    report2.bottleneck === null ? report2.bottleneckNote ?? "No bottleneck." : `Bottleneck: ${report2.bottleneck.stage} (${Math.round(report2.bottleneck.share * 100)}% of waiting)`
  ];
  if (report2.skippedLines > 0) {
    lines.push(`skipped ${report2.skippedLines} malformed ledger line(s)`);
  }
  return `${lines.join("\n")}
`;
}
var report = {
  summary: `map ledger events to stages; per stage active, waiting, event counts and toil (starting, stopping, waiting, retrying), and the bottleneck (--min-ideas N, default ${MIN_COMPLETED_IDEAS}; --as-of TIME; --ledger PATH; --json is one object, version ${REPORT_VERSION}: version, asOf, ideas, minCompletedIdeas, stages, bottleneck, bottleneckNote, unmappedEvents, skippedLines)`,
  options: { "min-ideas": "string", "as-of": "string", ledger: "string" },
  async run(context) {
    const flags = parseFlags(context);
    const { deps, json } = context;
    const fail3 = (message, code) => {
      deps.stderr(
        json ? `${JSON.stringify({ error: message })}
` : `${message}
`
      );
      return code;
    };
    if ("error" in flags) {
      return fail3(flags.error, 2);
    }
    const opened = await openLedger(context);
    if ("error" in opened) {
      return fail3(opened.error, 1);
    }
    const { events, skipped } = await opened.ledger.list({});
    const printed = {
      ...buildReport(events, flags),
      skippedLines: skipped
    };
    deps.stdout(json ? `${JSON.stringify(printed)}
` : text2(printed));
    return 0;
  }
};
var flowCommands = { report };

// src/cli/measurement.ts
var measurement = {
  ledger: ledgerCommands,
  flow: flowCommands
};

// src/plan/parser.ts
var FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
var UPCOMING_STEPS = 3;
function planNumber(name) {
  return Number.parseInt(name, 10);
}
function planStatus(markdown) {
  const frontmatter2 = FRONTMATTER.exec(markdown)?.[1];
  return frontmatter2 === void 0 ? void 0 : /^status: *(\S*) *$/m.exec(frontmatter2)?.[1];
}
function listItemSpans(markdown) {
  const items = [];
  let heading = "";
  let current = null;
  for (const [index, line2] of markdown.split("\n").entries()) {
    if (line2.startsWith("## ")) {
      heading = line2.slice(3).trim();
    }
    if (line2.startsWith("- ")) {
      current = { heading, text: line2.trim(), line: index, end: index + 1 };
      items.push(current);
    } else if (current && /^\s+\S/.test(line2)) {
      current.text += ` ${line2.trim()}`;
      current.end = index + 1;
    } else {
      current = null;
    }
  }
  return items;
}
function listItems(markdown) {
  return listItemSpans(markdown).map(({ heading, text: text3 }) => ({
    heading,
    text: text3
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
  return [...openSteps(markdown)].map(([heading, count2]) => ({
    step: heading.split(":")[0] ?? heading,
    count: count2
  }));
}
var FENCE = /^\s*(```|~~~)/;
var LIST_MARKER = /^\s*([-*+]|\d+\.)\s/;
function nextBlocks(markdown) {
  const lines = markdown.split("\n");
  const blocks = [];
  let heading = "";
  let fenced = false;
  let open = null;
  for (const [index, line2] of lines.entries()) {
    const fence = FENCE.test(line2);
    const stops = fence || !line2.trim() || line2.startsWith("#") || LIST_MARKER.test(line2);
    if (open && !fenced && !stops) {
      open.text += ` ${line2.trim()}`;
      open.end = index + 1;
      continue;
    }
    open = null;
    if (fence) {
      fenced = !fenced;
    } else if (!fenced && line2.startsWith("## ")) {
      heading = line2.slice(3).trim();
    } else if (!fenced && line2.startsWith("Next:")) {
      open = {
        step: heading,
        text: line2.slice(5).trim(),
        line: index,
        end: index + 1
      };
      blocks.push(open);
    }
  }
  return blocks;
}
function nextStep(markdown) {
  const first = nextBlocks(markdown)[0];
  return first ? { step: first.step, text: first.text } : null;
}
function upcomingSteps(markdown) {
  const open = [...openSteps(markdown).keys()];
  const current = nextStep(markdown)?.step ?? open[0];
  const headings2 = markdown.split("\n").filter((line2) => line2.startsWith("## ")).map((line2) => line2.slice(3).trim());
  const after = headings2.slice(headings2.indexOf(current ?? "") + 1);
  return after.filter((heading) => open.includes(heading)).slice(0, UPCOMING_STEPS);
}
function activePlans(plans) {
  const active = [];
  let legacy;
  const byNumber = Object.keys(plans).sort(
    (a, b) => planNumber(b) - planNumber(a)
  );
  for (const name of byNumber) {
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
import { join as join2 } from "node:path";
var PLANS_DIR = "infra/plans";
async function readPlans(deps) {
  const root2 = await deps.root();
  let names2;
  try {
    names2 = (await deps.fs.readdir(join2(root2, PLANS_DIR))).filter(
      (n) => n.endsWith(".md")
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
  const plans = {};
  for (const name of names2) {
    plans[name] = await deps.fs.readFile(join2(root2, PLANS_DIR, name));
  }
  return plans;
}

// src/plan/active.ts
function describe5(plan2) {
  const open = plan2.open.map((o) => `${o.step} (${o.count})`).join(", ");
  const lines = [`${plan2.file}${plan2.default ? " (default)" : ""}`];
  lines.push(`  Open items: ${open || "none"}`);
  if (plan2.next) {
    lines.push(`  Next (${plan2.next.step}): ${plan2.next.text}`);
  }
  if (plan2.upcoming.length > 0) {
    lines.push(`  Upcoming: ${plan2.upcoming.join("; ")}`);
  }
  return lines.join("\n");
}
var planActive = {
  summary: "list the active plans, flagging the default (highest-numbered)",
  async run({ json, deps }) {
    const plans = await readPlans(deps);
    const names2 = activePlans(plans);
    const listed = names2.map((name, index) => {
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
    if (json) {
      deps.stdout(
        `${JSON.stringify({ default: names2[0] ?? null, plans: listed })}
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
import { join as join3 } from "node:path";

// src/plan/edits.ts
function trimCommon(edit, lines) {
  const before = lines.slice(edit.start, edit.end);
  let head = 0;
  while (head < before.length && head < edit.lines.length && before[head] === edit.lines[head]) {
    head++;
  }
  let tail = 0;
  while (tail < before.length - head && tail < edit.lines.length - head && before[before.length - 1 - tail] === edit.lines[edit.lines.length - 1 - tail]) {
    tail++;
  }
  const kept = { start: edit.start + head, end: edit.end - tail };
  const after = edit.lines.slice(head, edit.lines.length - tail);
  return kept.start === kept.end && after.length === 0 ? null : { ...kept, lines: after };
}

// src/plan/plan-edit.ts
function normalize(text3) {
  return text3.replace(/\s+/g, " ").trim();
}
function choosePlan(plans, requested) {
  const names2 = Object.keys(plans);
  if (requested !== void 0) {
    const named = /^\d+$/.test(requested) ? names2.filter((n) => n.startsWith(`${requested}-`)) : [];
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
function apply(lines, edits) {
  const out = [...lines];
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out.splice(edit.start, edit.end - edit.start, ...edit.lines);
  }
  return out;
}
function toChanges(lines, edits) {
  return edits.flatMap((edit) => trimCommon(edit, lines) ?? []).sort((a, b) => a.start - b.start).map((edit) => ({
    line: edit.start + 1,
    before: lines.slice(edit.start, edit.end),
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
function removals(lines) {
  return nextBlocks(lines.join("\n")).map(({ line: line2, end }) => {
    const blankBefore = line2 > 0 && (lines[line2 - 1] ?? "").trim() === "";
    const blankAfter = end < lines.length && (lines[end] ?? "").trim() === "";
    return {
      start: line2,
      end: blankBefore && blankAfter ? end + 1 : end,
      lines: []
    };
  });
}
function currentHeading(lines, markdown) {
  const open = openCounts(markdown).map((c) => c.step);
  const held = nextStep(markdown)?.step.split(":")[0];
  const step = held !== void 0 && open.includes(held) ? held : open[0];
  const index = lines.findIndex(
    (l) => l.startsWith("## ") && l.slice(3).trim().split(":")[0] === step
  );
  if (step === void 0 || index < 0) {
    throw new CommandError(
      "The plan has no open item, so there is no current step to put a Next: line under. Add an unchecked item, or use `harness plan clear-next`."
    );
  }
  return index;
}
function insertion(lines, heading, text3) {
  const blank = (lines[heading + 1] ?? "").trim() === "";
  const start = blank ? heading + 2 : heading + 1;
  return {
    start,
    end: start,
    lines: blank ? [`${NEXT} ${text3}`, ""] : ["", `${NEXT} ${text3}`, ""]
  };
}
function withInsertion(lines, removed, added) {
  const merged = removed.find((r) => r.start === added.start);
  const end = merged?.end ?? added.start;
  const followedByBlank = (lines[end] ?? "").trim() === "";
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
  const lines = markdown.split("\n");
  const edits = options.edits(lines, markdown);
  const changes = toChanges(lines, edits);
  const file = `${PLANS_DIR}/${name}`;
  const written = !options.dryRun && changes.length > 0;
  if (written) {
    await deps.fs.writeFile(
      join3(await deps.root(), file),
      apply(lines, edits).join("\n")
    );
  }
  if (json) {
    deps.stdout(
      `${JSON.stringify({ plan: file, dryRun: options.dryRun, written, changes })}
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
    const text3 = typeof raw === "string" ? normalize(raw) : "";
    if (text3 === "") {
      throw new CommandError(
        'Missing --text "<line>": say the first concrete action and any state the files cannot show.'
      );
    }
    return await write(deps, json, {
      planOption: typeof plan2 === "string" ? plan2 : void 0,
      dryRun: options["dry-run"] === true,
      headline: (file, dry) => `${dry ? "Would set" : "Set"} Next: in ${file}`,
      edits: (lines, markdown) => withInsertion(
        lines,
        removals(lines),
        insertion(lines, currentHeading(lines, markdown), text3)
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
      edits: (lines) => removals(lines),
      unchanged: "No Next: line to clear"
    });
  }
};

// src/plan/tick.ts
import { join as join4 } from "node:path";

// src/plan/totals.ts
var TOTALS = /as of \d{4}-\d{2}-\d{2}: (\d+) local, (\d+) managed(\s+)cluster, (\d+) release(\s+)pipeline/;
function totalsEdits(lines, range, className, date) {
  const firstClass = lines.findIndex(
    (l, i) => i > range[0] && i < range[1] && l.startsWith("### ")
  );
  const introEnd = firstClass < 0 ? range[1] : firstClass;
  const intro = lines.slice(range[0], introEnd).join("\n");
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
  const text3 = `as of ${date}: ${next.local} local, ${next.managed} managed${match[3]}cluster, ${next.release} release${match[5]}pipeline`;
  const changed = intro.replace(TOTALS, text3).split("\n");
  const before = intro.split("\n");
  const edits = [];
  for (const [i, line2] of changed.entries()) {
    if (line2 !== before[i]) {
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
function sectionRange(lines) {
  const start = lines.indexOf(SECTION);
  if (start < 0) {
    return null;
  }
  const next = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return [start, next < 0 ? lines.length : next];
}
function entriesIn(lines, from, to) {
  const entries = [];
  for (let i = from; i < to; i++) {
    const line2 = lines[i] ?? "";
    const step = HEADER.exec(line2)?.[1];
    if (step === void 0) {
      continue;
    }
    let end = i + 1;
    while (end < to && /^\s+\S/.test(lines[end] ?? "")) {
      end++;
    }
    entries.push({
      start: i,
      end,
      step,
      raw: lines.slice(i, end).join("\n")
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
    const text3 = raw.slice(a, b);
    const start = a + (text3.length - text3.trimStart().length);
    const end = b - (text3.length - text3.trimEnd().length);
    const lead = LEAD.exec(raw.slice(start, end))?.[0];
    exit ||= lead !== void 0;
    return { start, end, itemStart: start + (lead?.length ?? 0), exit };
  });
}
function words(text3) {
  return new Set(
    (text3.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 4)
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
  const count2 = parsed - 1;
  const shown = /^\d+$/.test(word) ? String(count2) : NUMBERS[count2] ?? word;
  const noun = count2 === 1 ? "criterion" : "criteria";
  const [, , gap1, gap2, gap3] = lead;
  const text3 = `and ${shown}${gap1}exit${gap2}${noun}:${gap3}`;
  return raw.slice(0, segment.start) + text3 + raw.slice(segment.start + lead[0].length);
}
function sharedNote(raw, segments, index) {
  for (const [i, segment] of segments.entries()) {
    const text3 = raw.slice(segment.itemStart, segment.end);
    const note = /\([^)]*\b(both|all)\b[^)]*\)/i.exec(text3);
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
function classOf(lines, entry, from) {
  for (let i = entry.start; i >= from; i--) {
    const heading = /^### (.+)$/.exec(lines[i] ?? "")?.[1];
    if (heading !== void 0) {
      return heading;
    }
  }
  return "";
}
function locate2(entries, step, itemText) {
  const item = words(itemText);
  const scored = entries.flatMap(
    (entry) => segmentsOf(entry.raw).map((segment, index, all) => ({
      entry,
      all,
      index,
      score: score(item, entry.raw.slice(segment.itemStart, segment.end))
    }))
  );
  scored.sort((a, b) => b.score - a.score);
  const [best, runnerUp] = scored;
  const close2 = runnerUp !== void 0 && runnerUp.score >= MIN_SCORE && (best?.score ?? 0) - runnerUp.score <= MARGIN;
  if (best === void 0 || best.score < MIN_SCORE || close2) {
    return {
      error: `Cannot tell which list entry under ${step} holds this item. Reword the list entry to share words with the item, or tick it by hand.`
    };
  }
  return best;
}
function listEdits(lines, step, itemText, date) {
  const range = sectionRange(lines);
  if (range === null) {
    return { edits: [] };
  }
  const entries = entriesIn(lines, range[0], range[1]).filter(
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
    lines
  );
  const totals = totalsEdits(
    lines,
    range,
    classOf(lines, best.entry, range[0]),
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
  const open = matching.filter((i) => i.text.startsWith(OPEN));
  if (open.length === 1) {
    return open[0];
  }
  if (open.length > 1) {
    throw new CommandError(
      `"${wanted}" matches ${open.length} open items. Use a longer, more specific part of the item text.`
    );
  }
  const done = matching.length > 0 ? " It is already ticked." : "";
  throw new CommandError(
    `"${wanted}" matches no open item.${done} Run \`harness plan active\` to see the open items.`
  );
}
function tickEdit(lines, item) {
  const first = lines[item.line] ?? "";
  return {
    start: item.line,
    end: item.line + 1,
    lines: [`- [x]${first.slice(OPEN.length)}`]
  };
}
function describe6(file, step, text3, dryRun, changes) {
  return renderChanges(
    `${dryRun ? "Would tick" : "Ticked"} ${step}: ${text3} in ${file}`,
    changes
  );
}
async function tick(deps, json, item, planOption, dryRun) {
  const plans = await readPlans(deps);
  const name = choosePlan(plans, planOption);
  const markdown = plans[name] ?? "";
  const lines = markdown.split("\n");
  const span = chooseItem(markdown, item);
  const step = span.heading.split(":")[0] ?? span.heading;
  const text3 = normalize(span.text.slice(OPEN.length));
  const date = localDate(deps.clock.now());
  const lists = listEdits(lines, step, text3, date);
  if ("error" in lists) {
    throw new CommandError(lists.error);
  }
  const edits = [tickEdit(lines, span), ...lists.edits];
  const changes = toChanges(lines, edits);
  const file = `${PLANS_DIR}/${name}`;
  if (!dryRun) {
    await deps.fs.writeFile(
      join4(await deps.root(), file),
      apply(lines, edits).join("\n")
    );
  }
  deps.stdout(
    json ? `${JSON.stringify({ plan: file, item: { step, text: text3 }, dryRun, written: !dryRun, changes })}
` : describe6(file, step, text3, dryRun, changes)
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
    const delta = 1 / (panes.length - i) - split.ratio;
    if (Math.abs(delta) <= 5e-4) {
      continue;
    }
    const [pane, direction] = delta < 0 ? [panes[i + 1], "up"] : [panes[i], "down"];
    const resize = await runner.run("herdr", [
      "pane",
      "resize",
      "--pane",
      pane.pane_id,
      "--direction",
      direction,
      "--amount",
      Math.abs(delta).toFixed(6)
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
var FAILED2 = 1;
function fail(deps, json, code, message) {
  deps.stderr(
    `${json ? `${JSON.stringify({ error: message })}
` : ""}${message}
`
  );
  return code;
}

// src/session/registry.ts
import { join as join5, resolve as resolve4 } from "node:path";
var STATE_DIR = ".kore/state/sessions";
function isRecord(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record2 = value;
  return typeof record2.name === "string" && typeof record2.paneId === "string" && typeof record2.callerPane === "string" && typeof record2.model === "string";
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
    return new _SessionRegistry(deps.fs, resolve4(main, STATE_DIR));
  }
  file(name) {
    return join5(this.dir, `${name}.json`);
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
  async write(record2) {
    await this.fs.writeFile(
      this.file(record2.name),
      `${JSON.stringify(record2, null, 2)}
`
    );
  }
  /** Why `name` cannot be spawned again: its record exists and is not closed. Undefined when free. */
  async unavailable(name) {
    const existing = await this.read(name);
    return existing === void 0 || existing.closedAt !== void 0 ? void 0 : `A session record for ${name} (pane ${existing.paneId}) already exists and is not closed; run \`session wait ${name}\` then \`session close ${name}\`, or pick another name. No pane was split.`;
  }
  /** Records a new session; refuses to replace one that is not closed, even under a race. */
  async create(record2) {
    const content = `${JSON.stringify(record2, null, 2)}
`;
    try {
      await this.fs.createFile(this.file(record2.name), content);
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      const reason = await this.unavailable(record2.name);
      if (reason !== void 0) {
        throw new CommandError(
          reason.replace(
            " No pane was split.",
            ` Pane ${record2.paneId} is running unrecorded; close it with \`herdr pane close ${record2.paneId}\`.`
          )
        );
      }
      await this.write(record2);
    }
  }
};

// src/session/close.ts
var NOT_IN_HERDR = "Not inside Herdr (HERDR_ENV is not 1 or HERDR_PANE_ID is unset). Run this from the Herdr pane that spawned the session.";
function refuse(record2, callerPane) {
  const { name, paneId } = record2;
  if (record2.closedAt !== void 0) {
    return `Session ${name} is already closed (pane ${paneId}).`;
  }
  if (record2.callerPane !== callerPane) {
    return `Session ${name} was spawned from pane ${record2.callerPane}, not ${callerPane}; only that pane may close it.`;
  }
  return record2.result === void 0 ? `Session ${name} has no recorded result, so pane ${paneId} stays open. Run \`session wait ${name}\` first.` : void 0;
}
async function finishClose({ json, deps }, registry, record2, callerPane) {
  const { name } = record2;
  await registry.write({ ...record2, closedAt: deps.clock.now().toISOString() });
  const equalized = await equalize(deps.runner, callerPane);
  const note = equalized.status === "failed" ? `Closed, but equalizing failed: ${equalized.reason}` : void 0;
  if (note !== void 0) {
    deps.stderr(`${note}
`);
  }
  deps.stdout(
    json ? `${JSON.stringify({ name, paneId: record2.paneId, closed: true, equalize: equalized })}
` : `Closed ${name} (pane ${record2.paneId}).
`
  );
  return 0;
}
async function close(context) {
  const { json, deps } = context;
  const name = context.operand;
  if (name === void 0) {
    return fail(
      deps,
      json,
      USAGE_ERROR,
      "Missing the session name: session close <name>."
    );
  }
  const nameError = sessionNameError(name);
  if (nameError !== void 0) {
    return fail(deps, json, USAGE_ERROR, nameError);
  }
  const callerPane = deps.env.HERDR_PANE_ID;
  if (deps.env.HERDR_ENV !== "1" || !callerPane) {
    return fail(deps, json, FAILED2, NOT_IN_HERDR);
  }
  const registry = await SessionRegistry.open(deps);
  const record2 = await registry.read(name);
  if (record2 === void 0) {
    return fail(
      deps,
      json,
      FAILED2,
      `This tool did not create a session named ${name}, so it will not close one. Close it yourself with \`herdr pane close <pane-id>\` if you are sure.`
    );
  }
  const refusal = refuse(record2, callerPane);
  if (refusal !== void 0) {
    return fail(deps, json, FAILED2, refusal);
  }
  const closed = await deps.runner.run("herdr", [
    "pane",
    "close",
    record2.paneId
  ]);
  if (closed.code !== 0) {
    return fail(
      deps,
      json,
      FAILED2,
      `herdr pane close ${record2.paneId} failed: ${describeFailure(closed)}`
    );
  }
  return await finishClose(context, registry, record2, callerPane);
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
async function launch(deps, { role, model, effort, name, brief, paneId, callerPane, leftOpen }) {
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
    buildBrief({ task: brief, name, callerPane }),
    "--wait",
    "--until",
    "working",
    "--timeout",
    "5000"
  ]);
  return prompt.code === 0 ? checked : {
    error: `herdr agent prompt failed: ${describeFailure(prompt)}. Session ${name} is running in pane ${paneId} without its brief.`
  };
}

// src/session/wait.ts
var DEFAULT_TIMEOUT_MS = 60 * 60 * 1e3;
var POLL_MS = 2e3;
var MARKER = /^[ \t]*(?:[●⏺][ \t]+)?RESULT: (done|blocked)[ \t\r]*$/gm;
function findResult(text3) {
  const last = [...text3.matchAll(MARKER)].at(-1)?.[1];
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
async function waitForResult(deps, registry, record2, timeoutMs) {
  const done = (outcome) => ({
    name: record2.name,
    paneId: record2.paneId,
    model: record2.model,
    outcome,
    summary: `pane ${record2.paneId}`
  });
  if (record2.result !== void 0) {
    return done(record2.result.outcome);
  }
  const deadline = deps.clock.now().getTime() + timeoutMs;
  for (; ; ) {
    const read = await deps.runner.run("herdr", [
      "pane",
      "read",
      record2.paneId,
      "--source",
      "recent-unwrapped"
    ]);
    if (read.code !== 0) {
      return {
        error: `herdr pane read ${record2.paneId} failed: ${describeFailure(read)}`
      };
    }
    const outcome = findResult(read.stdout);
    if (outcome !== void 0) {
      await registry.write({
        ...record2,
        result: { outcome, at: deps.clock.now().toISOString() }
      });
      return done(outcome);
    }
    if (deps.clock.now().getTime() + POLL_MS > deadline) {
      return {
        error: `Session ${record2.name} printed no "RESULT: done" or "RESULT: blocked" line in pane ${record2.paneId} within ${seconds2(timeoutMs)}. It may still be working; run \`session wait ${record2.name}\` again or read the pane.`
      };
    }
    await deps.clock.sleep(POLL_MS);
  }
}
function formatWait(result) {
  return `${result.name} (${result.model}) finished: RESULT ${result.outcome}; summary in ${result.summary}.
`;
}
async function wait(context) {
  const { json, deps, options } = context;
  const name = context.operand;
  if (name === void 0) {
    return fail(
      deps,
      json,
      USAGE_ERROR,
      "Missing the session name: session wait <name>."
    );
  }
  const nameError = sessionNameError(name);
  if (nameError !== void 0) {
    return fail(deps, json, USAGE_ERROR, nameError);
  }
  const timeout = parseTimeout(options.timeout);
  if (typeof timeout !== "number") {
    return fail(deps, json, USAGE_ERROR, timeout.error);
  }
  const registry = await SessionRegistry.open(deps);
  const record2 = await registry.read(name);
  if (record2 === void 0) {
    return fail(
      deps,
      json,
      FAILED2,
      `No session named ${name} was spawned by this tool; start it with \`session spawn\`.`
    );
  }
  const result = await waitForResult(deps, registry, record2, timeout);
  if ("error" in result) {
    return fail(deps, json, FAILED2, result.error);
  }
  deps.stdout(json ? `${JSON.stringify(result)}
` : formatWait(result));
  return 0;
}

// src/session/spawn-finish.ts
async function finish({ json, deps, options }, { registry, record: record2, modelCheck, timeoutMs }) {
  const { name, paneId, callerPane, model, role, effort } = record2;
  await registry.create(record2);
  const verdict = modelCheck.status === "verified" ? "model verified" : `model unverified: ${modelCheck.reason}`;
  if (options["no-wait"] === true) {
    deps.stdout(
      json ? `${JSON.stringify({ name, paneId, model, role, effort, modelCheck })}
` : `Spawned ${name} (${model}; ${verdict}) in pane ${paneId}; it will broadcast to ${callerPane} when it finishes. Collect its result with \`session wait ${name}\`.
`
    );
    return 0;
  }
  const result = await waitForResult(deps, registry, record2, timeoutMs);
  if ("error" in result) {
    return fail(deps, json, FAILED2, result.error);
  }
  deps.stdout(
    json ? `${JSON.stringify({ ...result, role, effort, modelCheck })}
` : `${formatWait(result).trimEnd()} (${verdict}).
`
  );
  return 0;
}

// src/session/spawn.ts
var REQUIRED3 = ["role", "model", "effort", "name", "brief"];
function paneIdOf(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    const id = parsed.result?.pane?.pane_id;
    return typeof id === "string" ? id : void 0;
  } catch {
    return void 0;
  }
}
function check({ deps, options }) {
  const usage2 = (error) => ({ error, code: USAGE_ERROR });
  const missing = REQUIRED3.find((flag) => typeof options[flag] !== "string");
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
  const timeoutMs = parseTimeout(options.timeout);
  if (typeof timeoutMs !== "number") {
    return usage2(timeoutMs.error);
  }
  const callerPane = deps.env.HERDR_PANE_ID;
  if (deps.env.HERDR_ENV !== "1") {
    return {
      error: "Not inside Herdr (HERDR_ENV is not 1). Run this from a Herdr pane; no session was started.",
      code: FAILED2
    };
  }
  if (callerPane === void 0 || callerPane === "") {
    return {
      error: "HERDR_PANE_ID is not set, so the session cannot broadcast back. Run this from a Herdr pane.",
      code: FAILED2
    };
  }
  return { values: given, callerPane, timeoutMs };
}
async function splitPane(deps, callerPane) {
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
    deps.cwd,
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
async function spawn2(context) {
  const { json, deps } = context;
  const checked = check(context);
  if ("error" in checked) {
    return fail(deps, json, checked.code, checked.error);
  }
  const { name, model, role, effort } = checked.values;
  const { callerPane } = checked;
  const registry = await SessionRegistry.open(deps);
  const taken = await registry.unavailable(name) ?? await nameTakenError(deps, name);
  if (taken !== void 0) {
    return fail(deps, json, FAILED2, taken);
  }
  const paneId = await splitPane(deps, callerPane);
  if (typeof paneId !== "string") {
    return fail(deps, json, FAILED2, paneId.error);
  }
  const leftOpen = `The pane ${paneId} was left open; close it with \`herdr pane close ${paneId}\`.`;
  const equalized = await equalize(deps.runner, callerPane);
  if (equalized.status === "failed") {
    return fail(deps, json, FAILED2, `${equalized.reason}. ${leftOpen}`);
  }
  const modelCheck = await launch(deps, {
    ...checked.values,
    paneId,
    callerPane,
    leftOpen
  });
  if ("error" in modelCheck) {
    return fail(deps, json, FAILED2, modelCheck.error);
  }
  return await finish(context, {
    registry,
    modelCheck,
    record: {
      name,
      paneId,
      callerPane,
      model,
      role,
      effort,
      createdAt: deps.clock.now().toISOString()
    },
    timeoutMs: checked.timeoutMs
  });
}

// src/session/index.ts
var spawnCommand = {
  summary: "start a Claude session in a Herdr pane (--role --model --effort --name --brief --timeout ms); it waits for the result unless --no-wait, the normal pattern: spawn with --no-wait, then run `session wait <name>` in the background",
  options: {
    role: "string",
    model: "string",
    effort: "string",
    name: "string",
    brief: "string",
    "no-wait": "boolean",
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
  run: close
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
    const text3 = result.status === "skipped" ? `Skipped: ${result.reason}.` : "Equalized.";
    deps.stdout(json ? `${JSON.stringify(result)}
` : `${text3}
`);
    return 0;
  }
};
var session = {
  spawn: spawnCommand,
  wait: waitCommand,
  close: closeCommand,
  equalize: equalizeCommand
};

// src/skill/index.ts
import { join as join6 } from "node:path";

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
function field(frontmatter2, key) {
  const line2 = frontmatter2.split("\n").find((l) => l.startsWith(`${key}:`));
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
function auditSkill(directory, text3) {
  const source = text3.replaceAll("\r\n", "\n");
  if (!source.startsWith("---\n")) {
    return invalid(directory, "missing frontmatter");
  }
  const close2 = /\n---[ \t]*(\n|$)/.exec(source.slice(3));
  if (close2 === null) {
    return invalid(directory, "unterminated frontmatter");
  }
  const end = close2.index + 3;
  const frontmatter2 = source.slice(4, end);
  const name = field(frontmatter2, "name");
  if (name === void 0) {
    return invalid(directory, "missing name");
  }
  const description = field(frontmatter2, "description");
  if (description === void 0) {
    return invalid(directory, "missing description");
  }
  if (/^[>|][+-]?$/.test(description)) {
    return invalid(directory, "multi-line description");
  }
  const bodyLines = countLines(source.slice(end + close2[0].length));
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
function renderReport(report2) {
  const width = Math.max(4, ...report2.skills.map((s) => s.name.length));
  const lines = [
    `${"NAME".padEnd(width)}  DESC  BODY  VERDICT`,
    ...report2.skills.map(
      (s) => `${s.name.padEnd(width)}  ${String(s.descriptionChars).padStart(4)}  ${String(s.bodyLines).padStart(4)}  ${s.verdict}${detail(s)}`
    ),
    "",
    `${report2.summary.ok} ok, ${report2.summary["over-budget"]} over-budget, ${report2.summary.invalid} invalid`
  ];
  return `${lines.join("\n")}
`;
}

// src/skill/index.ts
var SKILLS_DIR = "skills";
var audit = {
  summary: "report each skill's description and body against its budgets",
  options: { strict: "boolean" },
  async run({ json, options, deps }) {
    const skillsDir = join6(await deps.root(), SKILLS_DIR);
    let report2;
    try {
      report2 = await auditSkills(deps.fs, skillsDir);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new CommandError(
          `No skills directory at ${skillsDir}. Run from the repository, or set CLAUDE_PROJECT_DIR to its root.`
        );
      }
      throw error;
    }
    deps.stdout(json ? `${JSON.stringify(report2)}
` : renderReport(report2));
    const failing = report2.summary["over-budget"] + report2.summary.invalid > 0;
    return options["strict"] === true && failing ? 1 : 0;
  }
};
var skill = { audit };

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
  session,
  skill,
  idea: ideaCommands,
  ...measurement
};

// src/cli/cli.ts
var USAGE_ERROR2 = 2;
var FAILURE = 1;
function usage() {
  const lines = ["Usage: harness <domain> <command> [--json]", "", "Commands:"];
  for (const [domain, commands] of Object.entries(domains)) {
    for (const [name, command] of Object.entries(commands)) {
      lines.push(`  harness ${domain} ${name}  ${command.summary}`);
    }
  }
  lines.push(
    "",
    "Flags:",
    "  --json  print machine-readable output",
    "  --help  show this usage"
  );
  return `${lines.join("\n")}
`;
}
function fail2(deps, json, message) {
  const prefix = json ? `${JSON.stringify({ error: message })}
` : "";
  deps.stderr(`${prefix}${message}

${usage()}`);
  return USAGE_ERROR2;
}
function own(table, key) {
  return Object.hasOwn(table, key) ? table[key] : void 0;
}
function names(commands) {
  return Object.keys(commands).join(", ");
}
function resolve5(domain, name) {
  const commands = own(domains, domain);
  if (commands === void 0) {
    return {
      error: `Unknown domain "${domain}". Domains: ${Object.keys(domains).join(", ")}.`
    };
  }
  if (name === void 0) {
    return {
      error: `Missing command for domain "${domain}". Commands: ${names(commands)}.`
    };
  }
  const command = own(commands, name);
  if (command === void 0) {
    return {
      error: `Unknown command "${name}" for domain "${domain}". Commands: ${names(commands)}.`
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
async function execute(command, context) {
  try {
    return await command.run(context);
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    const { json, deps } = context;
    const prefix = json ? `${JSON.stringify({ error: error.message })}
` : "";
    deps.stderr(`${prefix}${error.message}
`);
    return FAILURE;
  }
}
async function run(argv, deps) {
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
  const early = argv.slice(0, words2[1] ?? 0).find((t) => t.startsWith("-") && !["--json", "--help", "-h"].includes(t));
  if (early !== void 0) {
    return fail2(
      deps,
      json,
      `Put "${early}" after the command: harness <domain> <command> [flags].`
    );
  }
  const resolved = resolve5(domain, name);
  if ("error" in resolved) {
    return fail2(deps, json, resolved.error);
  }
  const parsed = parseOptions(resolved.command, rest);
  if ("error" in parsed) {
    return fail2(deps, json, parsed.error);
  }
  return await execute(resolved.command, {
    json,
    options: parsed.options,
    operand: parsed.operand,
    deps
  });
}

// src/main.ts
var stderr = (text3) => process.stderr.write(text3);
var root;
try {
  process.exitCode = await run(process.argv.slice(2), {
    runner: new ProcessRunner(),
    clock: systemClock,
    fs: nodeFileSystem,
    ids: systemIds,
    env: process.env,
    cwd: process.cwd(),
    stdin: async () => {
      const chunks = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString("utf8");
    },
    root: () => root ??= resolveRoot(
      process.env,
      import.meta.url,
      (path) => nodeFileSystem.exists(path)
    ),
    stdout: (text3) => process.stdout.write(text3),
    stderr
  });
} catch (error) {
  stderr(`${error instanceof Error ? error.message : String(error)}
`);
  process.exitCode = 1;
}
