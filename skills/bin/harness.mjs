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

// src/plan/active.ts
import { join } from "node:path";

// src/plan/parser.ts
var FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
var UPCOMING_STEPS = 3;
function planNumber(name) {
  return Number.parseInt(name, 10);
}
function planStatus(markdown) {
  const frontmatter = FRONTMATTER.exec(markdown)?.[1];
  return frontmatter === void 0 ? void 0 : /^status: *(\S*) *$/m.exec(frontmatter)?.[1];
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
  const headings = markdown.split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3).trim());
  const after = headings.slice(headings.indexOf(current ?? "") + 1);
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
    names2 = (await deps.fs.readdir(join(root2, PLANS_DIR))).filter(
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
    plans[name] = await deps.fs.readFile(join(root2, PLANS_DIR, name));
  }
  return plans;
}
function describe(plan) {
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
      deps.stdout(`${listed.map(describe).join("\n")}
`);
    }
    return 0;
  }
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
  plan: { active: planActive }
};

// src/cli/cli.ts
var USAGE_ERROR = 2;
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
  return USAGE_ERROR;
}
function own(table, key) {
  return Object.hasOwn(table, key) ? table[key] : void 0;
}
function names(commands) {
  return Object.keys(commands).join(", ");
}
function resolve(domain, name, extra) {
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
  if (extra.length > 0) {
    return { error: `Unexpected argument "${extra[0]}".` };
  }
  return { command };
}
async function run(argv, deps) {
  const flags = argv.filter((a) => a.startsWith("-"));
  const words = argv.filter((a) => !a.startsWith("-"));
  const json = flags.includes("--json");
  const unknown = flags.find((f) => !["--json", "--help", "-h"].includes(f));
  if (unknown !== void 0) {
    return fail(deps, json, `Unknown flag "${unknown}".`);
  }
  const [domain, name, ...extra] = words;
  const help = flags.includes("--help") || flags.includes("-h");
  if (domain === void 0 || help && own(domains, domain) !== void 0) {
    deps.stdout(usage());
    return 0;
  }
  const resolved = resolve(domain, name, extra);
  if ("error" in resolved) {
    return fail(deps, json, resolved.error);
  }
  return await resolved.command.run({ json, deps });
}

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
import { dirname as dirname2, join as join2, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";
var PLANS = "infra/plans";
async function resolveRoot(env, moduleUrl, exists) {
  const fromEnv = env.CLAUDE_PROJECT_DIR;
  if (fromEnv !== void 0 && fromEnv !== "") {
    if (await exists(join2(fromEnv, PLANS))) {
      return fromEnv;
    }
    throw new Error(
      `CLAUDE_PROJECT_DIR is "${fromEnv}" but it has no ${PLANS}. Point it at the repository root or unset it.`
    );
  }
  const bundle = fileURLToPath(moduleUrl);
  const root2 = resolve2(dirname2(bundle), "../..");
  if (await exists(join2(root2, PLANS))) {
    return root2;
  }
  throw new Error(
    `Cannot find the repo root: ${bundle} is not at <root>/skills/bin and CLAUDE_PROJECT_DIR is unset. Run the committed skills/bin/harness.mjs or set CLAUDE_PROJECT_DIR to the repository root.`
  );
}

// src/main.ts
var stderr = (text) => process.stderr.write(text);
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
    stdout: (text) => process.stdout.write(text),
    stderr
  });
} catch (error) {
  stderr(`${error instanceof Error ? error.message : String(error)}
`);
  process.exitCode = 1;
}
