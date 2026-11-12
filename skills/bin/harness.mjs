// src/runtime/errors.ts
var CommandError = class extends Error {
};

// src/runtime/clock.ts
var systemClock = {
  now: () => /* @__PURE__ */ new Date()
};

// src/runtime/filesystem.ts
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
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
  readdir: (path) => readdir(path)
};

// src/runtime/runner.ts
import { spawn } from "node:child_process";
var ProcessRunner = class {
  async run(command, args, options = {}) {
    return await new Promise((resolve3) => {
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
        resolve3({ stdout, stderr: error.message, code: 127 });
      });
      child.on("close", (code) => {
        resolve3({ stdout, stderr: stderr2, code: code ?? 1 });
      });
      if (options.input !== void 0) {
        child.stdin?.end(options.input);
      }
    });
  }
};

// src/runtime/root.ts
import { dirname as dirname2, join, resolve } from "node:path";
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
  const root2 = resolve(dirname2(bundle), "../..");
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
    "test:unit": "vitest run"
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
function localDate(date) {
  const two = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}
function headingSlug(heading) {
  return heading.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-");
}
function headings(markdown) {
  const seen = /* @__PURE__ */ new Map();
  const found = [];
  let fence = null;
  for (const line of markdown.split("\n")) {
    const opener = /^\s*(```|~~~)/.exec(line)?.[1] ?? null;
    if (fence !== null || opener !== null) {
      fence = opener === fence ? null : fence ?? opener;
      continue;
    }
    const text2 = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1];
    if (text2 === void 0) {
      continue;
    }
    const base = headingSlug(text2);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    found.push({ text: text2, anchor: count > 0 ? `${base}-${count}` : base });
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
    const report = {
      dryRun,
      number,
      files: [
        {
          path,
          lines: body.slice(0, -1).map((text2, i) => ({ number: i + 1, text: text2 }))
        },
        { path: INDEX, lines: [{ number: index.line, text: entry }] }
      ]
    };
    if (!dryRun) {
      await this.fs.writeFile(this.abs(path), body.join("\n"));
      await this.fs.writeFile(this.abs(INDEX), index.text);
    }
    return report;
  }
  async readIndex() {
    if (!await this.fs.exists(this.abs(INDEX))) {
      throw new AdrError(`${INDEX} is missing; restore it from git.`);
    }
    return this.fs.readFile(this.abs(INDEX));
  }
  /** Puts the entry before the first later-numbered ADR line, else after the last one. */
  insert(text2, next, entry) {
    const lines = text2.split("\n");
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
        "--status superseded cannot be written by adr new, which has no superseded-by to record; create the ADR as proposed or accepted, then run `harness adr supersede` (planned, not built yet) or add superseded-by by hand."
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

// src/adr/commands.ts
var REQUIRED = ["title", "summary", "status", "source"];
function describe(report) {
  const verb = report.dryRun ? "Would write" : "Wrote";
  return `${report.files.map(
    (f) => `${verb} ${f.path} (lines ${f.lines[0]?.number}-${f.lines.at(-1)?.number})`
  ).join("\n")}
`;
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
  async run({ json, options, deps }) {
    try {
      const value = (key) => {
        const v = options[key];
        if (typeof v !== "string" || v.trim() === "") {
          throw new AdrError(`--${key} is required; pass --${key} <text>.`);
        }
        return v.trim();
      };
      const [title, summary, status, source] = REQUIRED.map(value);
      const refines = typeof options["refines"] === "string" ? options["refines"].trim() : void 0;
      const root2 = await deps.root().catch((cause) => {
        throw new AdrError(
          cause instanceof Error ? cause.message : String(cause)
        );
      });
      const report = await new Adrs(deps.fs, deps.clock, root2).create(
        { title, summary, status, source, ...refines ? { refines } : {} },
        options["dry-run"] === true
      );
      deps.stdout(json ? `${JSON.stringify(report)}
` : describe(report));
      return 0;
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
};
var adrCommands = { new: newAdr };

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
function frontmatter(text2) {
  const lines = text2.split("\n");
  if (lines[0] !== "---") {
    return null;
  }
  const keys = /* @__PURE__ */ new Map();
  for (const line of lines.slice(1)) {
    if (line === "---") {
      return keys;
    }
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (match?.[1] !== void 0) {
      keys.set(match[1], (match[2] ?? "").trim());
    }
  }
  return null;
}
function parseIdea(path, text2) {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const name = IDEA_FILE.exec(file);
  if (name?.[1] === void 0 || name[2] === void 0) {
    throw new IdeaError(
      `${path} is not named NNNN-slug.md; rename it to a four-digit number and a lowercase slug.`
    );
  }
  const keys = frontmatter(text2);
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
  const heading = /^# Idea \d{4}: (.+)$/m.exec(text2)?.[1];
  const record = {
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
      record[key] = get(key);
    }
  }
  return record;
}
function scalar(flag, value) {
  const text2 = (value ?? "").replace(/\s+/g, " ").trim();
  if (text2 === "") {
    throw new IdeaError(`Missing --${flag}; pass a non-empty value.`);
  }
  if (/^[[{|>&*!-]/.test(text2)) {
    throw new IdeaError(
      `--${flag} must not start with "${text2.slice(0, 1)}"; frontmatter holds plain text, so reword it.`
    );
  }
  return text2;
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
        const record2 = await this.read(existing);
        await this.ensureIndexed(record2);
        return { created: false, record: record2 };
      }
      const taken = names2.map((n) => Number(n.slice(0, 4)));
      const number = String(Math.max(0, ...taken) + 1).padStart(4, "0");
      const path = `${DIR}/${number}-${slug}.md`;
      const text2 = renderIdea(
        number,
        this.clock.now().toISOString().slice(0, 10),
        idea
      );
      try {
        await this.fs.createFile(this.abs(path), text2);
      } catch (error) {
        if (error.code === "EEXIST") {
          continue;
        }
        throw error;
      }
      const record = parseIdea(path, text2);
      await this.ensureIndexed(record);
      return { created: true, record };
    }
    throw new IdeaError(
      `Another writer keeps creating ideas in ${DIR}; rerun \`harness idea new\` once it finishes.`
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
  async ensureIndexed(record) {
    const index = await this.fs.readFile(this.abs(INDEX2));
    if (!index.includes(`](${record.path.replace(/^docs\//, "")})`)) {
      await this.fs.writeFile(
        this.abs(INDEX2),
        addEntry(index, record.path, record.summary)
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
function describe2(record) {
  const lines = [
    `Idea ${record.number}: ${record.title}`,
    `Date: ${record.date}`,
    `Summary: ${record.summary}`,
    `Hypothesis: ${record.hypothesis}`,
    `Expected outcome: ${record.expectedOutcome}`,
    `Measurement: ${record.measurement}`,
    `Safety pattern: ${record.safetyPattern}`
  ];
  for (const [label, value] of [
    ["Outcome", record.outcome],
    ["Issue", record.issue],
    ["Parent", record.parent]
  ]) {
    if (value !== void 0) {
      lines.push(`${label}: ${value}`);
    }
  }
  lines.push(`File: ${record.path}`);
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
      const { created, record } = await (await repository(context)).create(slug, idea);
      context.deps.stdout(
        context.json ? `${JSON.stringify({ created, ...record })}
` : `${created ? "Created" : "Already exists:"} ${record.path}
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
      const record = await (await repository(context)).get(ref.trim());
      context.deps.stdout(
        context.json ? `${JSON.stringify(record)}
` : describe2(record)
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
var ideaCommands = {
  new: create,
  list,
  show
};

// src/plan/active.ts
import { join as join2 } from "node:path";

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
function listItems(markdown) {
  const items = [];
  let heading = "";
  let current = null;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      heading = line.slice(3).trim();
    }
    if (line.startsWith("- ")) {
      current = { heading, text: line.trim() };
      items.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      current.text += ` ${line.trim()}`;
    } else {
      current = null;
    }
  }
  return items;
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
  return [...openSteps(markdown)].map(([heading, count]) => ({
    step: heading.split(":")[0] ?? heading,
    count
  }));
}
function nextStep(markdown) {
  let heading = "";
  let next = null;
  for (const line of markdown.split("\n")) {
    if (next) {
      if (!line.trim() || line.startsWith("#")) {
        break;
      }
      next.text += ` ${line.trim()}`;
    } else if (line.startsWith("## ")) {
      heading = line.slice(3).trim();
    } else if (line.startsWith("Next:")) {
      next = { step: heading, text: line.slice(5).trim() };
    }
  }
  return next;
}
function upcomingSteps(markdown) {
  const open = [...openSteps(markdown).keys()];
  const current = nextStep(markdown)?.step ?? open[0];
  const headings2 = markdown.split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3).trim());
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

// src/plan/active.ts
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
function describe3(plan) {
  const open = plan.open.map((o) => `${o.step} (${o.count})`).join(", ");
  const lines = [`${plan.file}${plan.default ? " (default)" : ""}`];
  lines.push(`  Open items: ${open || "none"}`);
  if (plan.next) {
    lines.push(`  Next (${plan.next.step}): ${plan.next.text}`);
  }
  if (plan.upcoming.length > 0) {
    lines.push(`  Upcoming: ${plan.upcoming.join("; ")}`);
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
      deps.stdout(`${listed.map(describe3).join("\n")}
`);
    }
    return 0;
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

// src/session/spawn.ts
var USAGE_ERROR = 2;
var FAILED2 = 1;
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
  if (options["no-wait"] !== true) {
    return usage2(
      "Waiting for the session's result is not supported yet; pass --no-wait and wait for its broadcast."
    );
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
  return { values: given, callerPane };
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
async function launch(deps, { role, model, effort, name, brief, paneId, callerPane, leftOpen }) {
  const start = await deps.runner.run("herdr", [
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
  if (start.code !== 0) {
    return `herdr agent start failed: ${describeFailure(start)}. ${leftOpen}`;
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
  return prompt.code === 0 ? void 0 : `herdr agent prompt failed: ${describeFailure(prompt)}. Session ${name} is running in pane ${paneId} without its brief.`;
}
async function spawn2(context) {
  const { json, deps } = context;
  const fail2 = (code, message) => {
    deps.stderr(
      `${json ? `${JSON.stringify({ error: message })}
` : ""}${message}
`
    );
    return code;
  };
  const checked = check(context);
  if ("error" in checked) {
    return fail2(checked.code, checked.error);
  }
  const { name, model, role, effort } = checked.values;
  const { callerPane } = checked;
  const taken = await nameTakenError(deps, name);
  if (taken !== void 0) {
    return fail2(FAILED2, taken);
  }
  const paneId = await splitPane(deps, callerPane);
  if (typeof paneId !== "string") {
    return fail2(FAILED2, paneId.error);
  }
  const leftOpen = `The pane ${paneId} was left open; close it with \`herdr pane close ${paneId}\`.`;
  const equalized = await equalize(deps.runner, callerPane);
  if (equalized.status === "failed") {
    return fail2(FAILED2, `${equalized.reason}. ${leftOpen}`);
  }
  const launchError = await launch(deps, {
    ...checked.values,
    paneId,
    callerPane,
    leftOpen
  });
  if (launchError !== void 0) {
    return fail2(FAILED2, launchError);
  }
  deps.stdout(
    json ? `${JSON.stringify({ name, paneId, model, role, effort })}
` : `Spawned ${name} (${model}) in pane ${paneId}; it will broadcast to ${callerPane} when it finishes.
`
  );
  return 0;
}

// src/session/index.ts
var spawnCommand = {
  summary: "start a Claude session in a Herdr pane (--role --model --effort --name --brief --no-wait)",
  options: {
    role: "string",
    model: "string",
    effort: "string",
    name: "string",
    brief: "string",
    "no-wait": "boolean"
  },
  run: spawn2
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
    const text2 = result.status === "skipped" ? `Skipped: ${result.reason}.` : "Equalized.";
    deps.stdout(json ? `${JSON.stringify(result)}
` : `${text2}
`);
    return 0;
  }
};
var session = {
  spawn: spawnCommand,
  equalize: equalizeCommand
};

// src/skill/index.ts
import { join as join3 } from "node:path";

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
  const line = frontmatter2.split("\n").find((l) => l.startsWith(`${key}:`));
  const value = line?.slice(key.length + 1).trim();
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
function auditSkill(directory, text2) {
  const source = text2.replaceAll("\r\n", "\n");
  if (!source.startsWith("---\n")) {
    return invalid(directory, "missing frontmatter");
  }
  const close = /\n---[ \t]*(\n|$)/.exec(source.slice(3));
  if (close === null) {
    return invalid(directory, "unterminated frontmatter");
  }
  const end = close.index + 3;
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
  const bodyLines = countLines(source.slice(end + close[0].length));
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
function renderReport(report) {
  const width = Math.max(4, ...report.skills.map((s) => s.name.length));
  const lines = [
    `${"NAME".padEnd(width)}  DESC  BODY  VERDICT`,
    ...report.skills.map(
      (s) => `${s.name.padEnd(width)}  ${String(s.descriptionChars).padStart(4)}  ${String(s.bodyLines).padStart(4)}  ${s.verdict}${detail(s)}`
    ),
    "",
    `${report.summary.ok} ok, ${report.summary["over-budget"]} over-budget, ${report.summary.invalid} invalid`
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
    const skillsDir = join3(await deps.root(), SKILLS_DIR);
    let report;
    try {
      report = await auditSkills(deps.fs, skillsDir);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new CommandError(
          `No skills directory at ${skillsDir}. Run from the repository, or set CLAUDE_PROJECT_DIR to its root.`
        );
      }
      throw error;
    }
    deps.stdout(json ? `${JSON.stringify(report)}
` : renderReport(report));
    const failing = report.summary["over-budget"] + report.summary.invalid > 0;
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
  plan: { active: planActive },
  adr: adrCommands,
  session,
  skill,
  idea: ideaCommands
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
function fail(deps, json, message) {
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
function resolve2(domain, name) {
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
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (!token.startsWith("--")) {
      return { error: `Unexpected argument "${token}".` };
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
  return { options };
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
  const words = [];
  argv.forEach((token, i) => {
    if (!token.startsWith("-") && words.length < 2) {
      words.push(i);
    }
  });
  const domain = argv[words[0] ?? -1];
  const name = argv[words[1] ?? -1];
  if (domain === void 0 || help && own(domains, domain) !== void 0) {
    deps.stdout(usage());
    return 0;
  }
  const rest = argv.filter(
    (token, i) => !words.includes(i) && token !== "--json" && token !== "--help" && token !== "-h"
  );
  const resolved = resolve2(domain, name);
  if ("error" in resolved) {
    return fail(deps, json, resolved.error);
  }
  const parsed = parseOptions(resolved.command, rest);
  if ("error" in parsed) {
    return fail(deps, json, parsed.error);
  }
  return await execute(resolved.command, {
    json,
    options: parsed.options,
    deps
  });
}

// src/main.ts
var stderr = (text2) => process.stderr.write(text2);
var root;
try {
  process.exitCode = await run(process.argv.slice(2), {
    runner: new ProcessRunner(),
    clock: systemClock,
    fs: nodeFileSystem,
    root: () => root ??= resolveRoot(
      process.env,
      import.meta.url,
      (path) => nodeFileSystem.exists(path)
    ),
    env: process.env,
    cwd: process.cwd(),
    stdout: (text2) => process.stdout.write(text2),
    stderr
  });
} catch (error) {
  stderr(`${error instanceof Error ? error.message : String(error)}
`);
  process.exitCode = 1;
}
